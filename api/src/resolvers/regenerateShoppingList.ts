import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findMenuById, lockMenu } from '../repositories/menuRepository.js';
import type { MenuRow } from '../repositories/menuRepository.js';
import {
  findShoppingListByMenu,
  findShoppingListItems,
  isPreservedShoppingListItem,
  mergeRegenerateShoppingList,
} from '../repositories/shoppingListRepository.js';
import type { ShoppingListRow } from '../repositories/shoppingListRepository.js';
import {
  buildEphemeralMergePreview,
  buildEphemeralNewShoppingListPreview,
  toGraphQLShoppingList,
} from '../mappers/shoppingList.js';
import type { GraphQLShoppingList } from '../mappers/shoppingList.js';
import { computeFreshShoppingListItems, createFreshShoppingList } from './shoppingListGenerationPipeline.js';
import { regenerateShoppingListArgsSchema } from '../validation/shoppingList.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface RegenerateShoppingListResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: RegenerateShoppingListResolverDeps = { getPool };

/**
 * `confirmed: false`'s branch (D8, E2E_MVP_PLAN.md §17.2.8) — computes
 * exactly what a `confirmed: true` call would write, WITHOUT writing
 * anything, and returns it as an unpersisted preview (`mappers/shoppingList.ts`'s
 * ephemeral builders). No prior list: the whole thing is ephemeral. A
 * prior list exists: real preserved rows (their actual ids/state) plus an
 * ephemeral freshly-recomputed auto portion — the client renders "N kept, M
 * recomputed" confirm-dialog copy straight from this response's own item
 * list (real counts, never hardcoded), per S6's own RED test.
 */
const buildPreview = async (
  client: PoolClient,
  menu: MenuRow,
  existingList: ShoppingListRow | null,
): Promise<GraphQLShoppingList> => {
  const freshAutoItems = await computeFreshShoppingListItems(client, menu);

  if (existingList === null) {
    return buildEphemeralNewShoppingListPreview(menu.householdId, menu.id, freshAutoItems);
  }

  const currentItems = await findShoppingListItems(client, existingList.id);
  const preservedItems = currentItems.filter(isPreservedShoppingListItem);
  return buildEphemeralMergePreview(existingList, preservedItems, freshAutoItems);
};

/**
 * Direct-Lambda resolver for `Mutation.regenerateShoppingList` — D8's
 * merge-regenerate design in full (E2E_MVP_PLAN.md §17.2.8). Same
 * `findMenuById` + `requireHouseholdMember` household resolution as
 * `generateShoppingList`.
 *
 * - No open list exists yet for `menuId`: behaves IDENTICALLY to a first
 *   `generateShoppingList` call regardless of `confirmed` — `confirmed: true`
 *   writes via the exact same `createFreshShoppingList` helper
 *   `generateShoppingList` itself calls; `confirmed: false` previews the
 *   same computation without writing.
 * - An open list already exists: `confirmed: true` preserves every
 *   already-had (`purchased`/`movedToPantry`) or manually-added
 *   (`sourceRecipeId: null`) item byte-identical, and replaces only the
 *   remaining auto-generated, not-yet-had portion with a fresh
 *   recomputation against CURRENT menu/pantry state
 *   (`mergeRegenerateShoppingList`); `confirmed: false` previews that same
 *   merge without writing.
 */
export const createRegenerateShoppingListHandler =
  (deps: RegenerateShoppingListResolverDeps) =>
  async (event: AppSyncResolverEvent<{ menuId: unknown; confirmed: unknown }>): Promise<GraphQLShoppingList> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = regenerateShoppingListArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId, confirmed } = parsedArgs.data;

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

        // Same menu-scoped advisory lock `generateShoppingList` takes, in
        // the identical position — see its own comment for why: without
        // it, two concurrent regenerate calls (or a regenerate racing a
        // generate) for the same menu could both act on a stale read of
        // `existingList`, producing duplicate rows rather than a clean
        // merge. Held even for the `confirmed: false` preview branch —
        // `computeFreshShoppingListItems` still reads current menu/pantry
        // state, and taking the lock unconditionally keeps this
        // resolver's locking behavior simple and uniform rather than
        // conditional on an argument.
        await lockMenu(client, menuId);

        const existingList = await findShoppingListByMenu(client, menuId);

        if (!confirmed) {
          return buildPreview(client, menu, existingList);
        }

        if (existingList === null) {
          const { list, items } = await createFreshShoppingList(client, menu);
          return toGraphQLShoppingList(list, items);
        }

        const freshAutoItems = await computeFreshShoppingListItems(client, menu);
        const mergedItems = await mergeRegenerateShoppingList(client, existingList.id, freshAutoItems);
        return toGraphQLShoppingList(existingList, mergedItems);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createRegenerateShoppingListHandler`'s returned function.
export const handler = withErrorHandling(createRegenerateShoppingListHandler(productionDeps));
