import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findMenuById } from '../repositories/menuRepository.js';
import { findShoppingListByMenu, findShoppingListItems } from '../repositories/shoppingListRepository.js';
import { toGraphQLShoppingList } from '../mappers/shoppingList.js';
import type { GraphQLShoppingList } from '../mappers/shoppingList.js';
import { generateShoppingListArgsSchema } from '../validation/shoppingList.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface ShoppingListResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: ShoppingListResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.shoppingList` (W18 S2,
 * `E2E_MVP_PLAN.md` §24.2.4, D4). `generateShoppingList`/
 * `regenerateShoppingList` are the only other ways to reach a
 * `ShoppingList`, and both are mutations — `generateShoppingList`
 * specifically throws `CONFLICT` if a list already exists for the menu
 * (confirmed live during W17 S5's own verification pass, §23.5), so
 * neither is safely callable as an idempotent "get." This field fills
 * that gap: a small, pure read, reusing the exact same
 * `findShoppingListByMenu` lookup `generateShoppingList.ts` already
 * performs to decide whether to throw `CONFLICT` — no second, parallel
 * lookup is written.
 *
 * Resolves the household from `menuId` the same `findMenuById` +
 * explicit `requireHouseholdMember` pattern `generateShoppingList`/
 * `addMenuItem`/`autoFillWeek` already use (mirrors `menu.ts`'s own
 * bare-query-resolver shape otherwise) — a nonexistent `menuId` and a
 * real one in another household both deny identically via the byte-
 * identical `ForbiddenError`/`DENIAL_MESSAGE`, never an existence
 * oracle.
 *
 * Returns `null` — not an error — when no OPEN list has been generated
 * yet for that menu (the dashboard's own empty state), matching `menu`'s
 * own "no implicit write, no error" convention for a missing read
 * target.
 */
export const createShoppingListHandler =
  (deps: ShoppingListResolverDeps) =>
  async (event: AppSyncResolverEvent<{ menuId: unknown }>): Promise<GraphQLShoppingList | null> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = generateShoppingListArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const menu = await findMenuById(client, menuId);
        if (menu === null) {
          throw new ForbiddenError(DENIAL_MESSAGE);
        }
        await requireHouseholdMember(client, callerUser.id, menu.householdId);

        const list = await findShoppingListByMenu(client, menuId);
        if (list === null) {
          return null;
        }
        const items = await findShoppingListItems(client, list.id);
        return toGraphQLShoppingList(list, items);
      },
      pool,
    );
  };

// See `menu.ts`'s identical comment: wraps only the exported production
// handler, not `createShoppingListHandler`'s returned function.
export const handler = withErrorHandling(createShoppingListHandler(productionDeps));
