import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { setRecipeInRotation as setRecipeInRotationRepo } from '../repositories/recipeRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLRecipe } from '../mappers/recipe.js';
import { setInRotationArgsSchema } from '../validation/setInRotation.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface SetInRotationResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `setRecipeInRotation`'s own signature, for forced-failure tests. */
  setRecipeInRotation?: typeof setRecipeInRotationRepo;
}

export const productionDeps: SetInRotationResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.setInRotation`. Same `id`-only
 * membership resolution as `favoriteRecipe.ts` — RLS on `recipes` is the
 * sole authorization; a nonexistent id and a real id in another household
 * both surface as the identical `NotFoundError`. `inRotation` is the
 * caller-supplied end state, not a toggle — idempotent by construction.
 * The mutation only flips the flag here; W10's `autoFillWeek` is what
 * actually consumes it (E2E_MVP_PLAN.md §4 W10 row).
 */
export const createSetInRotationHandler =
  (deps: SetInRotationResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown; inRotation: unknown }>): Promise<GraphQLRecipe> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = setInRotationArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id, inRotation } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const setRecipeInRotation = deps.setRecipeInRotation ?? setRecipeInRotationRepo;
        const row = await setRecipeInRotation(client, id, inRotation);
        if (row === null) {
          throw new NotFoundError('Recipe not found.');
        }
        return toGraphQLRecipe(row);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createSetInRotationHandler`'s returned function.
export const handler = withErrorHandling(createSetInRotationHandler(productionDeps));
