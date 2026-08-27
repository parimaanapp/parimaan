import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findRecipeIngredientsByRecipeId } from '../repositories/recipeRepository.js';
import { toGraphQLRecipeIngredient } from '../mappers/recipe.js';
import type { GraphQLRecipeIngredient } from '../mappers/recipe.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface RecipeIngredientsResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: RecipeIngredientsResolverDeps = { getPool };

/**
 * Field resolver for `Recipe.ingredients`, invoked only when a client
 * actually selects the field — `Query.recipes` deliberately never
 * hydrates it inline (E2E_MVP_PLAN.md §12.2.7/D5), the same
 * doesn't-pay-unless-selected pattern `userHouseholds.ts` uses for
 * `User.households`.
 *
 * There is NO `householdId` argument here to run `requireHouseholdMember`
 * against — the only input is the parent `Recipe.id` via `event.source`,
 * which is caller-influenceable data flowing through the response tree,
 * not proof of membership. Authorization is therefore entirely RLS: the
 * `parimaan.user_id` set by `withUserTransaction` drives
 * `recipe_ingredients`' parent-join policy (`recipe_id IN (SELECT id FROM
 * recipes)`, `1787808112003_recipes.ts`), which itself composes with
 * `recipes`' own membership policy. A non-member's call for a real recipe
 * in another household returns `[]`, indistinguishable from a recipe that
 * genuinely has no ingredients — same by-design collapse as
 * `pantryRepository.ts`'s `findPantryItemById` (§12.2.2/§12.5.2: this is
 * the highest-severity authorization surface in W6, and this field
 * resolver is exactly where it's exercised).
 */
export const createRecipeIngredientsHandler =
  (deps: RecipeIngredientsResolverDeps) =>
  async (
    event: AppSyncResolverEvent<Record<string, never>, { id: string }>,
  ): Promise<GraphQLRecipeIngredient[]> => {
    const identity = extractCallerIdentity(event.identity);

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const rows = await findRecipeIngredientsByRecipeId(client, event.source.id);
        return rows.map(toGraphQLRecipeIngredient);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createRecipeIngredientsHandler`'s returned function.
export const handler = withErrorHandling(createRecipeIngredientsHandler(productionDeps));
