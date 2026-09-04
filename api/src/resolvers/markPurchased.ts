import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  findShoppingListById,
  findShoppingListItemForHaveIt,
  findShoppingListItems,
  markItemPurchased as markItemPurchasedRepo,
} from '../repositories/shoppingListRepository.js';
import { upsertOrIncrementPantryItemForHaveIt as upsertOrIncrementPantryItemForHaveItRepo } from '../repositories/pantryRepository.js';
import { defaultExpiryDaysForCategory } from '../domain/defaultExpiry.js';
import { toGraphQLShoppingList } from '../mappers/shoppingList.js';
import type { GraphQLShoppingList } from '../mappers/shoppingList.js';
import { markPurchasedArgsSchema } from '../validation/markPurchased.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface MarkPurchasedResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `upsertOrIncrementPantryItemForHaveIt`'s own signature, for forced-failure atomicity tests. */
  upsertOrIncrementPantryItemForHaveIt?: typeof upsertOrIncrementPantryItemForHaveItRepo;
  /** Injectable seam matching `markItemPurchased`'s own signature, for forced-failure atomicity tests. */
  markItemPurchased?: typeof markItemPurchasedRepo;
}

export const productionDeps: MarkPurchasedResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.markPurchased` (W12 S3,
 * E2E_MVP_PLAN.md §18.3; D5/D6, §18.2.5/§18.2.6; SD §5.7-adjacent). A
 * close mirror of `haveIt.ts` (W11 S3), with two deliberate differences:
 *
 *   1. No `quantity` argument (D5, locked) — the pantry write always uses
 *      the shopping-list item's OWN already-known `quantity`/`unit`
 *      (`found.item.quantity`/`found.item.unit`), never a caller-supplied
 *      value. A `null` `quantity` (an item whose amount never parsed to a
 *      number, e.g. "to taste") falls back to `0` here — the pantry write
 *      still records the item's presence, matching D3's own "never
 *      fabricate data this module doesn't have" posture rather than
 *      guessing a nonzero amount.
 *   2. The fresh-row insert branch carries a real `expiryDays` (S1's
 *      `defaultExpiryDaysForCategory`, keyed off the item's own
 *      `category`) instead of `haveIt`'s `null` — threaded through
 *      `upsertOrIncrementPantryItemForHaveIt`'s new optional parameter as
 *      a plain value, per §18.5.2's own design note (never an internal
 *      caller-identity branch). A `null` `category` resolves to no
 *      default (`null`), the same as an explicit `"other"` category.
 *
 * Resolves the item's household the SAME id-only-then-RLS-scoped pattern
 * `haveIt` uses — `findShoppingListItemForHaveIt` discovers it by joining
 * out to the item's parent `shopping_lists` row. A `null` result
 * (nonexistent `itemId`, or a real one in another household) throws the
 * SAME `ForbiddenError`/`DENIAL_MESSAGE` `haveIt` already uses — never an
 * existence oracle. `requireHouseholdMember` is then called explicitly
 * with the discovered `householdId` as a second, defense-in-depth gate on
 * top of RLS, matching `haveIt`'s own belt-and-suspenders shape.
 *
 * Writes, in one transaction (`withUserTransaction` — a throw anywhere
 * below rolls back everything already written this call):
 *   1. `upsertOrIncrementPantryItemForHaveIt` — the SAME D2/D3 fuzzy-name,
 *      unit-conversion-aware upsert-or-increment `haveIt` uses, now with
 *      `expiryDays` threaded through for the fresh-row branch.
 *   2. `markItemPurchased` — flips `purchased`/`movedToPantry` and stamps
 *      `purchasedBy`/`purchasedAt`, guarded by `WHERE purchased = FALSE`
 *      so a second `markPurchased` call (or a prior `haveIt` call — both
 *      mutations share the same `purchased` flag) on the same item
 *      returns `null` here — mapped to `CONFLICT`, which rolls back step
 *      1's pantry write too via the same transaction.
 *
 * Returns the item's full parent `ShoppingList!` (D1's widened return
 * type, §18.2.1) so this mutation attaches to `onShoppingListChanged`.
 */
export const createMarkPurchasedHandler =
  (deps: MarkPurchasedResolverDeps) =>
  async (event: AppSyncResolverEvent<{ itemId: unknown }>): Promise<GraphQLShoppingList> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = markPurchasedArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { itemId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const found = await findShoppingListItemForHaveIt(client, itemId);
        if (found === null) {
          throw new ForbiddenError(DENIAL_MESSAGE);
        }
        await requireHouseholdMember(client, callerUser.id, found.householdId);

        const expiryDays =
          found.item.category === null ? null : defaultExpiryDaysForCategory(found.item.category);

        const upsertOrIncrementPantryItemForHaveIt =
          deps.upsertOrIncrementPantryItemForHaveIt ?? upsertOrIncrementPantryItemForHaveItRepo;
        await upsertOrIncrementPantryItemForHaveIt(client, {
          householdId: found.householdId,
          name: found.item.name,
          quantity: found.item.quantity ?? 0,
          unit: found.item.unit,
          addedBy: callerUser.id,
          expiryDays,
        });

        const markItemPurchased = deps.markItemPurchased ?? markItemPurchasedRepo;
        const updatedItem = await markItemPurchased(client, itemId, callerUser.id);
        if (updatedItem === null) {
          throw new ConflictError('This item has already been marked as purchased.');
        }

        const list = await findShoppingListById(client, updatedItem.shoppingListId);
        if (list === null) {
          // Unreachable against real data — `updatedItem.shoppingListId`
          // is a live FK into `shopping_lists`, read moments earlier in
          // this same transaction — but a defensive throw rather than an
          // unsafe non-null assertion, matching `haveIt.ts`'s identical
          // guard.
          throw new Error('markPurchased: shopping list vanished mid-transaction.');
        }
        const items = await findShoppingListItems(client, list.id);
        return toGraphQLShoppingList(list, items);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createMarkPurchasedHandler`'s returned function.
export const handler = withErrorHandling(createMarkPurchasedHandler(productionDeps));
