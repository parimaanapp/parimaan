import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  findInRotationRecipesForAutoFill,
  findMenuById,
  findMenuItems,
  findRecentRecipeUsage,
} from '../repositories/menuRepository.js';
import { findRecipesByIds } from '../repositories/recipeRepository.js';
import { findSettingsForHousehold } from '../repositories/householdRepository.js';
import {
  RECENCY_WINDOW_WEEKS,
  computeUnfilledSlots,
  defaultRng,
  enumerateEmptySlots,
  pickForSlots,
  scoreCandidate,
} from '../domain/rotationSelection.js';
import type { EmptySlot, ProposedPick, WeightedCandidate } from '../domain/rotationSelection.js';
import type { RotationCandidateRow } from '../repositories/menuRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLAutoFillPreviewResult, GraphQLProposedMenuItem } from '../mappers/menu.js';
import { autoFillPreviewArgsSchema } from '../validation/menu.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface AutoFillPreviewResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: AutoFillPreviewResolverDeps = { getPool };

/**
 * Groups `candidates` by role and attaches each one's weight (recency +
 * cuisine bias, §16.2.8 D1/D2), ready for `pickForSlots`. Pulled out of the
 * handler purely to keep it under this codebase's max-lines-per-function
 * lint rule.
 */
const buildCandidatesByRole = (
  candidates: readonly RotationCandidateRow[],
  cuisineTier1: readonly string[],
  cuisineTier2Weights: Record<string, unknown>,
  recentUsageByRecipeId: ReadonlyMap<string, number>,
): Map<string, WeightedCandidate[]> => {
  const byRole = new Map<string, WeightedCandidate[]>();
  for (const candidate of candidates) {
    const weeksAgo = recentUsageByRecipeId.get(candidate.id) ?? null;
    const weight = scoreCandidate(
      { recipeId: candidate.id, cuisineTier1: candidate.cuisineTier1, cuisineTier2: candidate.cuisineTier2 },
      cuisineTier1,
      cuisineTier2Weights,
      weeksAgo,
    );
    const pool = byRole.get(candidate.role) ?? [];
    pool.push({ recipeId: candidate.id, weight });
    byRole.set(candidate.role, pool);
  }
  return byRole;
};

/**
 * Hydrates each `pick` with its full `Recipe`, dropping (never throwing on)
 * a pick whose recipe id didn't come back from the batch fetch — see the
 * call site's own comment for why that's defensive, not expected.
 */
const hydratePicks = async (
  client: PoolClient,
  picks: readonly ProposedPick[],
): Promise<GraphQLProposedMenuItem[]> => {
  const recipes = await findRecipesByIds(client, [...new Set(picks.map((pick) => pick.recipeId))]);
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));

  return picks.flatMap((pick) => {
    const recipe = recipesById.get(pick.recipeId);
    if (recipe === undefined) {
      return [];
    }
    return [
      {
        recipeId: pick.recipeId,
        recipe: toGraphQLRecipe(recipe),
        dayOfWeek: pick.dayOfWeek,
        mealSlot: pick.mealSlot,
        slotRole: pick.slotRole,
      },
    ];
  });
};

/**
 * Loads every candidate recipe for `householdId` and scores it (recency +
 * cuisine bias) against `targetWeekStartDate`, grouped by role and ready
 * for `pickForSlots`. Pulled out of the handler purely to keep it under
 * this codebase's max-lines-per-function lint rule.
 */
const loadScoredCandidatesByRole = async (
  client: PoolClient,
  householdId: string,
  targetWeekStartDate: string,
  skipIngredients: readonly string[],
  cuisineTier1: readonly string[],
  cuisineTier2Weights: Record<string, unknown>,
): Promise<Map<string, WeightedCandidate[]>> => {
  const [candidateRows, recentUsage] = await Promise.all([
    findInRotationRecipesForAutoFill(client, householdId, skipIngredients),
    findRecentRecipeUsage(client, householdId, targetWeekStartDate, RECENCY_WINDOW_WEEKS),
  ]);
  const recentUsageByRecipeId = new Map(recentUsage.map((usage) => [usage.recipeId, usage.weeksAgo]));
  return buildCandidatesByRole(candidateRows, cuisineTier1, cuisineTier2Weights, recentUsageByRecipeId);
};

/**
 * Direct-Lambda resolver for `Query.autoFillPreview` — a pure read (W10
 * §16.2.1, D3). Proposes a full or partial week WITHOUT writing anything
 * to `menu_items`; the client either accepts the proposal verbatim or
 * edits it, then calls `Mutation.autoFillWeek` to commit. Safe to call
 * repeatedly — each call is a fresh, independently-random proposal (D11),
 * which is exactly what makes a free "regenerate" on the preview screen
 * possible.
 *
 * Same authorization shape as every other menu resolver:
 * `requireHouseholdMember` gated on the menu's own household, resolved via
 * `menuId` (no `householdId` argument, matching `addMenuItem`'s locked
 * signature) — a menu in another household is denied identically to a
 * nonexistent one.
 */
export const createAutoFillPreviewHandler =
  (deps: AutoFillPreviewResolverDeps) =>
  async (event: AppSyncResolverEvent<{ menuId: unknown }>): Promise<GraphQLAutoFillPreviewResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = autoFillPreviewArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const menu = await findMenuById(client, menuId);
        if (menu === null) {
          throw new ForbiddenError(DENIAL_MESSAGE);
        }
        await requireHouseholdMember(client, callerUser.id, menu.householdId);

        const settings = await findSettingsForHousehold(client, menu.householdId);
        if (settings === null) {
          throw new Error(`autoFillPreview: household ${menu.householdId} has no settings row.`);
        }

        const existingItems = await findMenuItems(client, menuId);
        const emptySlots: EmptySlot[] = enumerateEmptySlots(
          { mealsEnabled: settings.mealsEnabled, mealStructure: settings.mealStructure },
          existingItems,
        );

        const candidatesByRole = await loadScoredCandidatesByRole(
          client,
          menu.householdId,
          menu.weekStartDate,
          settings.skipIngredients,
          settings.cuisineTier1,
          settings.cuisineTier2Weights,
        );

        const picks = pickForSlots(emptySlots, candidatesByRole, defaultRng);
        const unfilledSlots = computeUnfilledSlots(emptySlots, picks);
        const items = await hydratePicks(client, picks);

        return { items, filledCount: items.length, unfilledSlots };
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createAutoFillPreviewHandler`'s returned function.
export const handler = withErrorHandling(createAutoFillPreviewHandler(productionDeps));
