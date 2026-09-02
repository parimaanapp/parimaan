import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  deleteUnmadeMenuItems,
  findMenuById,
  findMenuItems,
  insertMenuItem as insertMenuItemRepo,
  lockMenu,
} from '../repositories/menuRepository.js';
import { findRecipesByIds } from '../repositories/recipeRepository.js';
import type { RecipeRow } from '../repositories/recipeRepository.js';
import { findSettingsForHousehold } from '../repositories/householdRepository.js';
import { getMealSlotCap, isMealSlotEnabled, slotCountKeyRole } from '../domain/mealStructure.js';
import type { RotationHouseholdSettings } from '../domain/rotationSelection.js';
import { toGraphQLMenu } from '../mappers/menu.js';
import type { GraphQLAutoFillResult, GraphQLUnfilledSlot } from '../mappers/menu.js';
import { autoFillWeekArgsSchema } from '../validation/menu.js';
import type { MenuItemInput } from '../validation/menu.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface AutoFillWeekResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: AutoFillWeekResolverDeps = { getPool };

/**
 * Commits one submitted item if it still passes every live check —
 * household ownership, `mealsEnabled`, in-rotation, and cap, all
 * re-verified against the CURRENT database state rather than trusted from
 * whatever `autoFillPreview` proposed (time passed; another device could
 * have acted in between). `runningCounts` is mutated in place by the
 * caller's loop, not here — this function only reads it, so the caller
 * controls exactly when a successful insert's own slot becomes "occupied"
 * for the next item in the same batch.
 */
const tryCommitItem = async (
  client: PoolClient,
  menuId: string,
  householdId: string,
  item: MenuItemInput,
  recipesById: ReadonlyMap<string, RecipeRow>,
  settings: RotationHouseholdSettings,
  runningCounts: ReadonlyMap<string, number>,
): Promise<{ committed: true } | { committed: false }> => {
  if (!isMealSlotEnabled(settings.mealsEnabled, item.mealSlot)) {
    return { committed: false };
  }
  const recipe = recipesById.get(item.recipeId);
  if (recipe === undefined || recipe.householdId !== householdId || !recipe.inRotation) {
    return { committed: false };
  }

  const key = `${item.dayOfWeek}:${item.mealSlot}:${slotCountKeyRole(item.mealSlot, item.slotRole) ?? ''}`;
  const cap = getMealSlotCap(settings.mealStructure, item.mealSlot, item.slotRole);
  const currentCount = runningCounts.get(key) ?? 0;
  if (currentCount >= cap) {
    return { committed: false };
  }

  await insertMenuItemRepo(client, {
    menuId,
    recipeId: item.recipeId,
    dayOfWeek: item.dayOfWeek,
    mealSlot: item.mealSlot,
    slotRole: item.slotRole,
    servingsOverride: item.servingsOverride ?? null,
  });
  return { committed: true };
};

const slotCountKey = (dayOfWeek: number, mealSlot: string, slotRole: string): string =>
  `${dayOfWeek}:${mealSlot}:${slotCountKeyRole(mealSlot, slotRole) ?? ''}`;

/** Seeds a fresh running-count map from `menuId`'s CURRENT occupancy (post-delete-if-`overwrite`) — the starting point `commitAllItems` mutates in place as it commits. */
const seedRunningCounts = async (client: PoolClient, menuId: string): Promise<Map<string, number>> => {
  const runningCounts = new Map<string, number>();
  for (const existing of await findMenuItems(client, menuId)) {
    const key = slotCountKey(existing.dayOfWeek, existing.mealSlot, existing.slotRole);
    runningCounts.set(key, (runningCounts.get(key) ?? 0) + 1);
  }
  return runningCounts;
};

/**
 * Commits every submitted `items` entry that still passes `tryCommitItem`'s
 * live checks, in order — each successful commit immediately updates
 * `runningCounts` so the NEXT item in the same batch destined for the same
 * slot is correctly evaluated against the now-current occupancy, not stale
 * pre-batch state. Pulled out of the handler purely to keep it under this
 * codebase's max-lines-per-function/complexity lint rules.
 */
const commitAllItems = async (
  client: PoolClient,
  menuId: string,
  householdId: string,
  items: readonly MenuItemInput[],
  recipesById: ReadonlyMap<string, RecipeRow>,
  settings: RotationHouseholdSettings,
  runningCounts: Map<string, number>,
): Promise<{ filledCount: number; unfilledSlots: GraphQLUnfilledSlot[] }> => {
  const unfilledSlots: GraphQLUnfilledSlot[] = [];
  let filledCount = 0;

  for (const item of items) {
    const key = slotCountKey(item.dayOfWeek, item.mealSlot, item.slotRole);
    const result = await tryCommitItem(client, menuId, householdId, item, recipesById, settings, runningCounts);
    if (result.committed) {
      filledCount += 1;
      runningCounts.set(key, (runningCounts.get(key) ?? 0) + 1);
    } else {
      unfilledSlots.push({ dayOfWeek: item.dayOfWeek, mealSlot: item.mealSlot, slotRole: item.slotRole });
    }
  }

  return { filledCount, unfilledSlots };
};

/**
 * Direct-Lambda resolver for `Mutation.autoFillWeek` — the commit half of
 * W10's dry-run design (§16.2.1, D3). Takes the exact `items` a client is
 * accepting (verbatim from its last `autoFillPreview` call, or edited via
 * manual swaps) and writes them transactionally, re-validating each one
 * against LIVE state rather than trusting the proposal blindly. An item
 * that no longer fits (a manual add landed in its slot, its recipe left
 * rotation, etc.) is silently skipped, not an error — best-effort partial
 * commit, matching D6's "auto-fill is never all-or-nothing" answer; the
 * response's own `filledCount`/`unfilledSlots` report exactly what
 * happened, which can legitimately differ from what the preview promised.
 *
 * `overwrite: true` deletes every existing item WITHOUT `made_at` set
 * (manual or auto-filled alike, D4) BEFORE inserting — a row with
 * `made_at IS NOT NULL` (an already-cooked meal) is never touched,
 * regardless of `overwrite` (§16.2.7). Takes the menu-scoped `lockMenu`
 * for its entire transaction, in the same lock order `addMenuItem`
 * acquires it in — see `menuRepository.ts`'s own `lockMenu` doc for why
 * consistent ordering across both code paths matters (§16.2.6).
 */
export const createAutoFillWeekHandler =
  (deps: AutoFillWeekResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ menuId: unknown; overwrite: unknown; items: unknown }>,
  ): Promise<GraphQLAutoFillResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = autoFillWeekArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId, overwrite, items } = parsedArgs.data;

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

        await lockMenu(client, menuId);

        const settings = await findSettingsForHousehold(client, menu.householdId);
        if (settings === null) {
          throw new Error(`autoFillWeek: household ${menu.householdId} has no settings row.`);
        }

        if (overwrite) {
          await deleteUnmadeMenuItems(client, menuId);
        }

        const recipes = await findRecipesByIds(client, [...new Set(items.map((item) => item.recipeId))]);
        const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));

        // Incremented in place by `commitAllItems` as each item commits, so
        // the 2nd/3rd/... item destined for an already-full slot is
        // correctly rejected within this same batch, not just against
        // pre-batch state.
        const runningCounts = await seedRunningCounts(client, menuId);

        const { filledCount, unfilledSlots } = await commitAllItems(
          client,
          menuId,
          menu.householdId,
          items,
          recipesById,
          settings,
          runningCounts,
        );

        const finalItems = await findMenuItems(client, menuId);
        return {
          menu: toGraphQLMenu(menu, finalItems),
          filledCount,
          unfilledSlots,
        };
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createAutoFillWeekHandler`'s returned function.
export const handler = withErrorHandling(createAutoFillWeekHandler(productionDeps));
