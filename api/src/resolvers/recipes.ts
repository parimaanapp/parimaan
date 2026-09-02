import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findRecipes } from '../repositories/recipeRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLRecipe } from '../mappers/recipe.js';
import { recipesArgsSchema } from '../validation/recipes.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface RecipesResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: RecipesResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.recipes`. Flow matches `pantry.ts`:
 * validate identity → validate `{ householdId, role?, isFavorite? }` →
 * resolve caller → `requireHouseholdMember` (layer 2) inside a single
 * `withUserTransaction` scope, with `recipes`' `FOR ALL USING (...) WITH
 * CHECK (...)` policy as layer-3 defense-in-depth behind it → filtered
 * read. Denies a non-member identically to a nonexistent `householdId`.
 * Deliberately never selects/joins `recipe_ingredients` — see
 * `recipeIngredients.ts`'s doc for why that's a separate field resolver.
 */
export const createRecipesHandler =
  (deps: RecipesResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; role: unknown; isFavorite: unknown; inRotation: unknown }>,
  ): Promise<GraphQLRecipe[]> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = recipesArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, role, isFavorite, inRotation } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        // Same `!= null` (loose) pattern as `pantry.ts`: `.nullish()` means
        // an unset filter can parse to either `undefined` (key absent) or
        // `null` (key present, explicit null — the real AppSync/Ferry wire
        // shape for an unset nullable variable), and both must mean "no
        // filter" here.
        const filter: { role?: string; isFavorite?: boolean; inRotation?: boolean } = {};
        if (role != null) {
          filter.role = role;
        }
        if (isFavorite != null) {
          filter.isFavorite = isFavorite;
        }
        if (inRotation != null) {
          filter.inRotation = inRotation;
        }

        const rows = await findRecipes(client, householdId, filter);
        return rows.map(toGraphQLRecipe);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createRecipesHandler`'s returned function.
export const handler = withErrorHandling(createRecipesHandler(productionDeps));
