import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { insertPantryItem as insertPantryItemRepo } from '../repositories/pantryRepository.js';
import { canonicalizePantryCategory } from '../domain/pantryCategories.js';
import { canonicalizePantryUnit } from '../domain/pantryUnits.js';
import { toGraphQLPantryItem } from '../mappers/pantryItem.js';
import type { GraphQLPantryItem } from '../mappers/pantryItem.js';
import { bulkAddPantryItemsArgsSchema } from '../validation/bulkAddPantryItems.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface BulkAddPantryItemsResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `insertPantryItem`'s own signature, for forced-mid-batch-failure/rollback tests. */
  insertPantryItem?: typeof insertPantryItemRepo;
}

export const productionDeps: BulkAddPantryItemsResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.bulkAddPantryItems`. Flow matches
 * `addPantryItem.ts` (member-gated, `addedBy` from the verified caller
 * only, unit/category canonicalised), extended to a bounded (≤50,
 * `validation/bulkAddPantryItems.ts`) loop of inserts. No explicit
 * savepoint machinery: every insert already runs inside the single
 * `withUserTransaction` scope this resolver opens, and that wrapper rolls
 * back the whole transaction on any throw (`db/withUserTransaction.test.ts`
 * asserts this directly) — so a failure on item *k* undoes items
 * `0..k-1` for free, without a partial-success client contract to reason
 * about.
 */
export const createBulkAddPantryItemsHandler =
  (deps: BulkAddPantryItemsResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; items: unknown }>,
  ): Promise<GraphQLPantryItem[]> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = bulkAddPantryItemsArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, items } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const insertPantryItem = deps.insertPantryItem ?? insertPantryItemRepo;
        const inserted: GraphQLPantryItem[] = [];
        for (const item of items) {
          const row = await insertPantryItem(client, {
            householdId,
            name: item.name,
            quantity: item.quantity,
            unit: canonicalizePantryUnit(item.unit),
            category: item.category == null ? null : canonicalizePantryCategory(item.category),
            isStaple: item.isStaple ?? false,
            expiryDate: item.expiryDate ?? null,
            lowThreshold: item.lowThreshold ?? null,
            addedBy: callerUser.id,
          });
          inserted.push(toGraphQLPantryItem(row));
        }
        return inserted;
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createBulkAddPantryItemsHandler`'s returned function.
export const handler = withErrorHandling(createBulkAddPantryItemsHandler(productionDeps));
