import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  insertDefaultSettings as insertDefaultSettingsRepo,
  insertHousehold,
  insertMembership,
} from '../repositories/householdRepository.js';
import type { MembershipRow, SettingsRow } from '../repositories/householdRepository.js';
import {
  insertRecipe,
  insertRecipeIngredient as insertRecipeIngredientRepo,
} from '../repositories/recipeRepository.js';
import type { InsertRecipeIngredientInput, InsertRecipeInput } from '../repositories/recipeRepository.js';
import type { RandomIntFn } from '../domain/inviteCode.js';
import { attemptWithFreshInviteCode } from '../domain/inviteCodeAttempts.js';
import { toGraphQLHousehold, toGraphQLMembership } from '../mappers/household.js';
import type { GraphQLHousehold } from '../mappers/household.js';
import { toGraphQLUser } from '../mappers/user.js';
import { createHouseholdArgsSchema } from '../validation/createHousehold.js';
import { getCuratedRecipesNotYetWired } from '../curatedRecipes.js';
import type { CuratedRecipeInput, GetCuratedRecipesFn } from '../curatedRecipes.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface CreateHouseholdResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable RNG for `generateInviteCode`, for deterministic collision/exhaustion tests. */
  randomInt?: RandomIntFn;
  /**
   * Injectable seam for the default-settings insert step, matching
   * `insertDefaultSettings`'s own signature — defaults to the real
   * repository function. Tests use this to force a mid-transaction failure
   * and assert the whole transaction rolls back (no `households`/
   * `household_memberships` rows survive), the same way `randomInt` above
   * is injected for deterministic collision tests, rather than a test-only
   * boolean branch living in the production code path.
   */
  insertDefaultSettings?: typeof insertDefaultSettingsRepo;
  /**
   * Injectable seam for the curated-recipe-seeding step's recipe-list
   * source (W16 §22.3 S4), mirroring `insertDefaultSettings`'s own
   * override pattern above. Tests inject a small fixture list (2-3
   * recipes) instead of the real 50-file corpus, which S5 wires up as the
   * production default — see `curatedRecipes.ts`'s own doc. Also used to
   * force a mid-seeding failure (throwing here) for the rollback test,
   * the same way `insertDefaultSettings` is overridden to force a
   * mid-transaction failure.
   */
  getCuratedRecipes?: GetCuratedRecipesFn;
}

// `getCuratedRecipes` is deliberately omitted here (rather than pointed at
// a real corpus reader) — S5 wires the production default; until then, the
// handler's own `deps.getCuratedRecipes ?? getCuratedRecipesNotYetWired`
// fallback (below) is an empty list, so `createHousehold`'s four
// pre-existing steps behave identically to before this slice — see
// `curatedRecipes.ts`'s own doc for why an empty default (not a throw) is
// the deliberate choice here.
export const productionDeps: CreateHouseholdResolverDeps = { getPool };

/**
 * Builds the fifth transaction step's `insertRecipe` input for one curated
 * recipe (W16 §22.2.3 D3, §22.2.4 D4) — mirrors `createRecipe.ts`'s own
 * `toInsertRecipeInput`, with two columns FIXED rather than derived from
 * caller input: `sourceType: 'curated'` (never left to `insertRecipe`'s own
 * `'user'`-shaped default) and `sourceUrl: null` (curated recipes carry no
 * source URL). `createdBy` is the household's own creator
 * (`callerUser.id`), never a sentinel user — D3's own locked decision.
 */
const toInsertCuratedRecipeInput = (
  householdId: string,
  input: CuratedRecipeInput,
  createdBy: string,
): InsertRecipeInput => ({
  householdId,
  sourceType: 'curated',
  sourceUrl: null,
  title: input.title,
  description: input.description ?? null,
  servings: input.servings ?? 4,
  prepMin: input.prepMin ?? null,
  cookMin: input.cookMin ?? null,
  cuisineTier1: input.cuisineTier1 ?? null,
  cuisineTier2: input.cuisineTier2 ?? null,
  dietaryTags: input.dietaryTags ?? [],
  role: input.role,
  // Not special-cased for seeded rows (D4) — takes `insertRecipe`'s own
  // normal default (`true`), identical to a manually created recipe.
  inRotation: input.inRotation ?? true,
  steps: input.steps,
  createdBy,
});

const toInsertCuratedRecipeIngredientInput = (
  recipeId: string,
  ingredient: CuratedRecipeInput['ingredients'][number],
  sortOrder: number,
): InsertRecipeIngredientInput => ({
  recipeId,
  name: ingredient.name,
  quantity: ingredient.quantity ?? null,
  unit: ingredient.unit ?? null,
  category: ingredient.category ?? null,
  notes: ingredient.notes ?? null,
  isStaple: ingredient.isStaple ?? false,
  sortOrder,
});

/**
 * Direct-Lambda resolver for `Mutation.createHousehold`. Flow: validate the
 * caller's identity → validate `{ name }` → resolve/upsert the caller's
 * `users` row (works even if the client never called `me` first) →
 * within a single `withUserTransaction` scope: insert the household (with
 * invite-code retry), then the caller's `primary` membership, then default
 * settings, then curated-recipe seeding — in that order, because
 * `household_settings`'s and `recipes`'s RLS policies both require the
 * membership row to already exist (W16 §22.2.2 D2). `primaryUserId` is
 * derived exclusively from `identity.sub` (via the resolved `users.id`),
 * never from any mutation argument — there is no such argument on this
 * mutation.
 *
 * The curated-recipe step (D2) is INSIDE this same transaction, not a
 * separate post-commit path: a household is never observable
 * partially-seeded — either the whole transaction commits (household +
 * membership + settings + every curated recipe and its ingredients) or
 * none of it does, the same all-or-nothing discipline every other
 * multi-row mutation in this codebase already follows.
 */
export const createCreateHouseholdHandler =
  (deps: CreateHouseholdResolverDeps) =>
  async (event: AppSyncResolverEvent<{ name: unknown }>): Promise<GraphQLHousehold> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = createHouseholdArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { name } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);
    const graphQLUser = toGraphQLUser(callerUser);

    return withUserTransaction(
      callerUser.id,
      async (txClient) => {
        // Generate-then-insert (not generate-then-UPDATE): `invite_code` is
        // `NOT NULL UNIQUE`, so it cannot be inserted as null and filled in
        // afterward — the retry has to wrap the insert itself.
        const household = await attemptWithFreshInviteCode(
          txClient,
          (inviteCode) =>
            insertHousehold(txClient, { name, inviteCode, primaryUserId: callerUser.id }),
          deps.randomInt,
        );

        const membershipRow: MembershipRow = await insertMembership(txClient, {
          householdId: household.id,
          userId: callerUser.id,
          role: 'primary',
        });

        const insertSettings = deps.insertDefaultSettings ?? insertDefaultSettingsRepo;
        const settings: SettingsRow = await insertSettings(txClient, household.id);

        // Fifth step (W16 §22.2.2 D2): curated-recipe seeding. Runs after
        // settings, inside this same transaction — recipes' own RLS policy
        // is household-membership-scoped exactly like settings', so it
        // inherits the identical "membership must exist first" ordering
        // constraint. `getCuratedRecipes` returning/throwing is what
        // determines this step's own success/failure; a throw here (a
        // fixture list function that throws, or a downstream `insertRecipe`
        // failure) propagates out of `withUserTransaction`'s callback and
        // rolls back the ENTIRE transaction — no household, no membership,
        // no settings, no partial recipes survive.
        const getCuratedRecipes = deps.getCuratedRecipes ?? getCuratedRecipesNotYetWired;
        const curatedRecipes = getCuratedRecipes();
        for (const curatedRecipe of curatedRecipes) {
          const recipe = await insertRecipe(
            txClient,
            toInsertCuratedRecipeInput(household.id, curatedRecipe, callerUser.id),
          );
          for (const [index, ingredient] of curatedRecipe.ingredients.entries()) {
            await insertRecipeIngredientRepo(
              txClient,
              toInsertCuratedRecipeIngredientInput(recipe.id, ingredient, index),
            );
          }
        }

        const membership = toGraphQLMembership(
          { ...membershipRow, household, settings },
          graphQLUser,
        );

        return toGraphQLHousehold(household, [membership], settings);
      },
      pool,
    );
  };

// See `me.ts`'s identical comment: wraps only the exported production
// handler, not `createCreateHouseholdHandler`'s returned function.
export const handler = withErrorHandling(createCreateHouseholdHandler(productionDeps));
