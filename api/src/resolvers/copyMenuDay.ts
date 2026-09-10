import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  findMenuById,
  findMenuItems,
  findMenuItemsForDay,
  insertMenuItem as insertMenuItemRepo,
} from '../repositories/menuRepository.js';
import type { MenuItemRow, MenuRow } from '../repositories/menuRepository.js';
import { validateAddMenuItem } from './addMenuItem.js';
import { toGraphQLMenu } from '../mappers/menu.js';
import type { GraphQLCopyMenuResult } from '../mappers/menu.js';
import { copyMenuDayArgsSchema } from '../validation/menu.js';
import type { MenuItemInput } from '../validation/menu.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface CopyMenuDayResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: CopyMenuDayResolverDeps = { getPool };

/**
 * Tries to place ONE source item onto `toDay` of `targetMenu`, reusing
 * `addMenuItem.ts`'s own `validateAddMenuItem` unchanged (W14 S8,
 * E2E_MVP_PLAN.md §20.2.8, D8: "copy reuses `validateAddMenuItem`'s
 * existing per-slot validation") — re-checked against the TARGET's own
 * `mealConfigSnapshot`, never assumed from the source. A source item that
 * doesn't fit (mealSlot disabled, cap reached — which also covers an
 * already-cooked target slot, since a `madeAt`-set item still occupies its
 * slot's count) throws `ConflictError`; a source item whose recipe has
 * since been deleted throws `NotFoundError`. Both are caught HERE and
 * reported as "skipped" rather than propagated — the best-effort-with-
 * honest-reporting posture D7 (`bulkAddPantryItems`) and D6 (`autoFillWeek`)
 * already established, never an error that aborts the whole copy. Nothing
 * is ever deleted by this function — a copy only INSERTs, so "never
 * overwriting a cooked item" holds by construction, not by a special case.
 */
const tryCopyOneItem = async (
  client: PoolClient,
  targetMenu: MenuRow,
  toDay: number,
  sourceItem: MenuItemRow,
): Promise<boolean> => {
  const input: MenuItemInput = {
    recipeId: sourceItem.recipe.id,
    dayOfWeek: toDay,
    // `MenuItemRow.mealSlot`/`slotRole` are the DB's `string` columns
    // (already constrained by their own `CHECK` constraints at insert
    // time — the same guarantee `addMenuItem`'s own insert relies on), so
    // this narrowing cast is safe: any row read back from `menu_items` can
    // only ever hold one of `MenuItemInput`'s own literal values.
    mealSlot: sourceItem.mealSlot as MenuItemInput['mealSlot'],
    slotRole: sourceItem.slotRole as MenuItemInput['slotRole'],
    servingsOverride: sourceItem.servingsOverride,
  };

  try {
    await validateAddMenuItem(client, targetMenu, input);
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) {
      return false;
    }
    throw error;
  }

  await insertMenuItemRepo(client, {
    menuId: targetMenu.id,
    recipeId: input.recipeId,
    dayOfWeek: input.dayOfWeek,
    mealSlot: input.mealSlot,
    slotRole: input.slotRole,
    servingsOverride: input.servingsOverride ?? null,
  });
  return true;
};

/**
 * Direct-Lambda resolver for `Mutation.copyMenuDay` (W14 S8,
 * E2E_MVP_PLAN.md §20.2.8/§20.3, D8). Reads `fromDay`'s items on `menuId`'s
 * own menu and, for each, attempts to place it onto `toDay` of the SAME
 * menu via `tryCopyOneItem` above — `copiedCount`/`skippedCount` report
 * exactly what happened. `fromDay === toDay` is not specially rejected: a
 * source item copied onto its own already-occupied day/slot will typically
 * be skipped by the cap check, the same outcome a client would get from
 * calling `addMenuItem` directly for that slot.
 *
 * Gated identically to `addMenuItem`/`clearMenuDay`: `menuId` resolves the
 * household via `findMenuById` (RLS-scoped, no existence oracle),
 * `requireHouseholdMember` throws the byte-identical denial either way.
 * `validateAddMenuItem` itself takes the menu-scoped `lockMenu` (and the
 * per-slot `lockMenuSlot`) for EACH item it validates — see that function's
 * own comment for why the same lock ordering `addMenuItem` uses matters
 * here too; this resolver takes no additional lock of its own.
 */
export const createCopyMenuDayHandler =
  (deps: CopyMenuDayResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ menuId: unknown; fromDay: unknown; toDay: unknown }>,
  ): Promise<GraphQLCopyMenuResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = copyMenuDayArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId, fromDay, toDay } = parsedArgs.data;

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

        const sourceItems = await findMenuItemsForDay(client, menuId, fromDay);

        let copiedCount = 0;
        let skippedCount = 0;
        for (const sourceItem of sourceItems) {
          const copied = await tryCopyOneItem(client, menu, toDay, sourceItem);
          if (copied) {
            copiedCount += 1;
          } else {
            skippedCount += 1;
          }
        }

        const finalItems = await findMenuItems(client, menuId);
        return {
          menu: toGraphQLMenu(menu, finalItems),
          copiedCount,
          skippedCount,
        };
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createCopyMenuDayHandler`'s returned function.
export const handler = withErrorHandling(createCopyMenuDayHandler(productionDeps));
