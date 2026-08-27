import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { deleteRecipeById as deleteRecipeByIdRepo } from '../repositories/recipeRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLRecipe } from '../mappers/recipe.js';
import { deleteRecipeArgsSchema } from '../validation/updateRecipe.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface DeleteRecipeResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `deleteRecipeById`'s own signature, for forced-failure tests. */
  deleteRecipeById?: typeof deleteRecipeByIdRepo;
}

export const productionDeps: DeleteRecipeResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.deleteRecipe`. Same `id`-only
 * membership resolution as `deletePantryItem.ts` — see that file's doc for
 * why a nonexistent id and a real id in another household are
 * indistinguishable by design, and both surface as the identical
 * `NotFoundError`. Returns the deleted `Recipe!` (§12.2.5, matching
 * `deletePantryItem`'s `PantryItem!` precedent) — `recipe_ingredients`
 * cascade-deletes for free via the FK.
 */
export const createDeleteRecipeHandler =
  (deps: DeleteRecipeResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown }>): Promise<GraphQLRecipe> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = deleteRecipeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const deleteRecipeById = deps.deleteRecipeById ?? deleteRecipeByIdRepo;
        const row = await deleteRecipeById(client, id);
        if (row === null) {
          throw new NotFoundError('Recipe not found.');
        }
        return toGraphQLRecipe(row);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createDeleteRecipeHandler`'s returned function.
export const handler = withErrorHandling(createDeleteRecipeHandler(productionDeps));
