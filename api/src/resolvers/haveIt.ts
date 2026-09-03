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
  markItemHaveIt as markItemHaveItRepo,
} from '../repositories/shoppingListRepository.js';
import { upsertOrIncrementPantryItemForHaveIt as upsertOrIncrementPantryItemForHaveItRepo } from '../repositories/pantryRepository.js';
import { toGraphQLShoppingList } from '../mappers/shoppingList.js';
import type { GraphQLShoppingList } from '../mappers/shoppingList.js';
import { haveItArgsSchema } from '../validation/haveIt.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface HaveItResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `upsertOrIncrementPantryItemForHaveIt`'s own signature, for forced-failure atomicity tests. */
  upsertOrIncrementPantryItemForHaveIt?: typeof upsertOrIncrementPantryItemForHaveItRepo;
  /** Injectable seam matching `markItemHaveIt`'s own signature, for forced-failure atomicity tests. */
  markItemHaveIt?: typeof markItemHaveItRepo;
}

export const productionDeps: HaveItResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.haveIt` (W11 S3, E2E_MVP_PLAN.md
 * §17.3; SD §5.7). Resolves the item's household the same id-only-then-
 * RLS-scoped pattern `updatePantryItem`'s own doc establishes —
 * `shopping_list_items` has no `householdId` argument, so
 * `findShoppingListItemForHaveIt` discovers it by joining out to the
 * item's parent `shopping_lists` row (itself RLS-scoped). A `null` result
 * (nonexistent `itemId`, or a real one in another household) throws the
 * SAME `ForbiddenError`/`DENIAL_MESSAGE` `generateShoppingList`/
 * `regenerateShoppingList` (S2) already use for their own id-lookup
 * denials — never an existence oracle. `requireHouseholdMember` is then
 * called explicitly with the discovered `householdId` as a second,
 * defense-in-depth gate on top of RLS, the same belt-and-suspenders shape
 * `generateShoppingList` uses after its own `findMenuById` lookup.
 *
 * Writes, in one transaction (`withUserTransaction` — a throw anywhere
 * below rolls back everything already written this call):
 *   1. `upsertOrIncrementPantryItemForHaveIt` — D2/D3's fuzzy-name,
 *      unit-conversion-aware upsert-or-increment into `pantry_items`.
 *   2. `markItemHaveIt` — flips `purchased`/`movedToPantry` and stamps
 *      `purchasedBy`/`purchasedAt`, guarded by `WHERE purchased = FALSE`
 *      so a second `haveIt` call on the same item returns `null` here
 *      (never a silent double pantry-increment) — mapped to a `CONFLICT`,
 *      which rolls back step 1's pantry write too via the same
 *      transaction. This is the locked, tested behavior for calling
 *      `haveIt` twice: explicitly rejected, not idempotent-silent.
 *
 * Returns the item's full parent `ShoppingList!` (D1's widened return
 * type, §17.2.1) so this mutation can attach to a future
 * `onShoppingListChanged` subscription without a second return-type
 * change — not built this slice.
 */
export const createHaveItHandler =
  (deps: HaveItResolverDeps) =>
  async (event: AppSyncResolverEvent<{ itemId: unknown; quantity: unknown }>): Promise<GraphQLShoppingList> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = haveItArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { itemId, quantity } = parsedArgs.data;

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

        const upsertOrIncrementPantryItemForHaveIt =
          deps.upsertOrIncrementPantryItemForHaveIt ?? upsertOrIncrementPantryItemForHaveItRepo;
        await upsertOrIncrementPantryItemForHaveIt(client, {
          householdId: found.householdId,
          name: found.item.name,
          quantity,
          unit: found.item.unit,
          addedBy: callerUser.id,
        });

        const markItemHaveIt = deps.markItemHaveIt ?? markItemHaveItRepo;
        const updatedItem = await markItemHaveIt(client, itemId, callerUser.id);
        if (updatedItem === null) {
          throw new ConflictError('This item has already been marked as have-it.');
        }

        const list = await findShoppingListById(client, updatedItem.shoppingListId);
        if (list === null) {
          // Unreachable against real data — `updatedItem.shoppingListId`
          // is a live FK into `shopping_lists`, read moments earlier in
          // this same transaction — but a defensive throw rather than an
          // unsafe non-null assertion, matching this codebase's
          // "never assume a fully-consistent snapshot" stance elsewhere
          // (e.g. `shoppingListGeneration.ts`'s own `recipe === undefined`
          // guard).
          throw new Error('haveIt: shopping list vanished mid-transaction.');
        }
        const items = await findShoppingListItems(client, list.id);
        return toGraphQLShoppingList(list, items);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createHaveItHandler`'s returned function.
export const handler = withErrorHandling(createHaveItHandler(productionDeps));
