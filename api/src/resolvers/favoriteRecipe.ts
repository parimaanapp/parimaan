import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { setRecipeFavorite as setRecipeFavoriteRepo } from '../repositories/recipeRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLRecipe } from '../mappers/recipe.js';
import { favoriteRecipeArgsSchema } from '../validation/favoriteRecipe.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface FavoriteRecipeResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `setRecipeFavorite`'s own signature, for forced-failure tests. */
  setRecipeFavorite?: typeof setRecipeFavoriteRepo;
}

export const productionDeps: FavoriteRecipeResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.favoriteRecipe`. Same `id`-only
 * membership resolution as `updateRecipe.ts`/`deleteRecipe.ts` — RLS on
 * `recipes` is the sole authorization; a nonexistent id and a real id in
 * another household both surface as the identical `NotFoundError`.
 * `favorite` is the caller-supplied end state, not a toggle — idempotent
 * by construction. Household-level, not per-user (PRD §7.1): any member
 * setting the flag changes what every member sees.
 */
export const createFavoriteRecipeHandler =
  (deps: FavoriteRecipeResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown; favorite: unknown }>): Promise<GraphQLRecipe> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = favoriteRecipeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id, favorite } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const setRecipeFavorite = deps.setRecipeFavorite ?? setRecipeFavoriteRepo;
        const row = await setRecipeFavorite(client, id, favorite);
        if (row === null) {
          throw new NotFoundError('Recipe not found.');
        }
        return toGraphQLRecipe(row);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createFavoriteRecipeHandler`'s returned function.
export const handler = withErrorHandling(createFavoriteRecipeHandler(productionDeps));
