import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findRecipeById as findRecipeByIdRepo } from '../repositories/recipeRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLRecipe } from '../mappers/recipe.js';
import { recipeArgsSchema } from '../validation/recipes.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface RecipeResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `findRecipeById`'s own signature, for forced-failure tests. */
  findRecipeById?: typeof findRecipeByIdRepo;
}

export const productionDeps: RecipeResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.recipe`. Added in W6 S7 (not in the
 * original SDL/plan text) so the Detail screen can read one recipe without
 * re-fetching the whole household's `Query.recipes` list just to select
 * `ingredients` on a single row — the exact per-Library-open cost D5/§12.2.7
 * wrote the Library/Detail split to avoid, just moved to the Detail screen
 * if this query didn't exist.
 *
 * Same `id`-only membership resolution as `updateRecipe`/`deleteRecipe`:
 * no `householdId` argument, so RLS alone gates the read — a nonexistent
 * id and a real id in another household are indistinguishable by design,
 * both surfacing as the identical `NotFoundError`. Never selects/joins
 * `recipe_ingredients` itself — `Recipe.ingredients` remains the separate
 * field resolver (`recipeIngredients.ts`), fired only when the caller's own
 * selection set asks for it, same as every other `Recipe`-returning query.
 */
export const createRecipeHandler =
  (deps: RecipeResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown }>): Promise<GraphQLRecipe> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = recipeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const findRecipeById = deps.findRecipeById ?? findRecipeByIdRepo;
        const row = await findRecipeById(client, id);
        if (row === null) {
          throw new NotFoundError('Recipe not found.');
        }
        return toGraphQLRecipe(row);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createRecipeHandler`'s returned function.
export const handler = withErrorHandling(createRecipeHandler(productionDeps));
