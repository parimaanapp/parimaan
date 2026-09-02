import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { deleteMenuItemById, findMenuItemHousehold } from '../repositories/menuRepository.js';
import { removeMenuItemArgsSchema } from '../validation/menu.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface RemoveMenuItemResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: RemoveMenuItemResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.removeMenuItem`. Idempotent by
 * construction (E2E_MVP_PLAN.md §15.3 S3): a nonexistent or already-removed
 * `id` returns `false`, never an error — matching `leaveHousehold`'s own
 * idempotent precedent, not `deletePantryItem`'s NotFound-on-repeat one,
 * since freeing an already-empty slot isn't a client error.
 *
 * `findMenuItemHousehold` joins through to `menus` under RLS on both
 * tables, so a real `id` in another household comes back `null` — identical
 * to a nonexistent one — and this resolver returns `false` for both without
 * distinguishing them, rather than throwing. When a row IS found,
 * `requireHouseholdMember` still runs as the explicit layer-2 gate (the
 * same defense-in-depth every other household-scoped mutation in this
 * codebase applies on top of RLS) before the delete.
 */
export const createRemoveMenuItemHandler =
  (deps: RemoveMenuItemResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown }>): Promise<boolean> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = removeMenuItemArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const found = await findMenuItemHousehold(client, id);
        if (found === null) {
          return false;
        }
        await requireHouseholdMember(client, callerUser.id, found.householdId);

        return deleteMenuItemById(client, id);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createRemoveMenuItemHandler`'s returned function.
export const handler = withErrorHandling(createRemoveMenuItemHandler(productionDeps));
