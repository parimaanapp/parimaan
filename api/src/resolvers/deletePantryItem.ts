import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { deletePantryItemById as deletePantryItemByIdRepo } from '../repositories/pantryRepository.js';
import { toGraphQLPantryItem } from '../mappers/pantryItem.js';
import type { GraphQLPantryItem } from '../mappers/pantryItem.js';
import { deletePantryItemArgsSchema } from '../validation/deletePantryItem.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface DeletePantryItemResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `deletePantryItemById`'s own signature, for forced-failure tests. */
  deletePantryItemById?: typeof deletePantryItemByIdRepo;
}

export const productionDeps: DeletePantryItemResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.deletePantryItem`. Same `id`-only
 * membership resolution as `updatePantryItem.ts` — see that file's doc for
 * why a nonexistent id and a real id in another household are
 * indistinguishable by design, and both surface as the identical
 * `NotFoundError`.
 */
export const createDeletePantryItemHandler =
  (deps: DeletePantryItemResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown }>): Promise<GraphQLPantryItem> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = deletePantryItemArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const deletePantryItemById = deps.deletePantryItemById ?? deletePantryItemByIdRepo;
        const row = await deletePantryItemById(client, id);
        if (row === null) {
          throw new NotFoundError('Pantry item not found.');
        }
        return toGraphQLPantryItem(row);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createDeletePantryItemHandler`'s returned function.
export const handler = withErrorHandling(createDeletePantryItemHandler(productionDeps));
