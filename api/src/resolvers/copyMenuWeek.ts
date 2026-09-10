import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  createMenu as createMenuRepo,
  findMenuById,
  findMenuItems,
  findMenuItemsForDay,
  insertMenuItem as insertMenuItemRepo,
} from '../repositories/menuRepository.js';
import type { MenuItemRow, MenuRow } from '../repositories/menuRepository.js';
import { validateAddMenuItem } from './addMenuItem.js';
import { toGraphQLMenu } from '../mappers/menu.js';
import type { GraphQLCopyMenuResult } from '../mappers/menu.js';
import { copyMenuWeekArgsSchema } from '../validation/menu.js';
import type { MenuItemInput } from '../validation/menu.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface CopyMenuWeekResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: CopyMenuWeekResolverDeps = { getPool };

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Identical to `copyMenuDay.ts`'s own `tryCopyOneItem` — kept as a separate
 * copy rather than a shared import because the two resolvers' surrounding
 * shapes differ enough (this one loops days, that one doesn't) that a
 * shared helper would need its own file for one four-line function; not
 * worth it at this size. Any change to the skip/catch behaviour here must
 * be mirrored there — see that file's own comment for the full rationale
 * (`validateAddMenuItem` reuse, why `NotFoundError` is caught too, why
 * nothing is ever deleted).
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
    // See `copyMenuDay.ts`'s identical cast for why this is safe: DB rows
    // are already constrained to these literal values by their own
    // `CHECK` constraints.
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
 * Direct-Lambda resolver for `Mutation.copyMenuWeek` (W14 S8,
 * E2E_MVP_PLAN.md §20.2.8/§20.3, D8) — the week-scoped sibling of
 * `copyMenuDay`. Targets a WEEK, not a menu (`toWeekStartDate`, not a
 * `toMenuId`): the target week commonly has no menu yet at all (copying
 * this week forward to next week, which has none until this call).
 *
 * Get-or-creates the target via the SAME `createMenu`-path repository call
 * S2 ships (`createMenuRepo`, idempotent by `menus`' own
 * `UNIQUE(household_id, week_start_date)`) — this is the single most
 * important line in this file. `createMenuRepo` computes the target menu's
 * `mealConfigSnapshot` from LIVE `household_settings` at the moment of
 * THIS call if the target week's menu doesn't exist yet, and returns the
 * pre-existing row (with its OWN already-frozen snapshot) untouched if it
 * does. Either way, the target's snapshot is never derived from or copied
 * out of the SOURCE menu's snapshot — the two are computed completely
 * independently, even though they may (coincidentally) hold the same
 * values if nothing changed between the two menus' creation times. See
 * `copyMenuWeek.test.ts`'s dedicated snapshot-independence test for the
 * direct regression coverage of this invariant.
 *
 * Cross-household copy is impossible by construction, not by a check:
 * `createMenuRepo` is called with the SOURCE menu's own `householdId` —
 * there is no argument path by which the target could land in a different
 * household (§20.2.8's explicit "out of scope").
 *
 * Each of the 7 source days is copied via the identical `tryCopyOneItem`
 * `copyMenuDay` uses, so an already-existing target week (re-copying, or
 * copying sideways) follows the identical "cooked items never touched,
 * only inserts" rule as a brand-new one.
 */
export const createCopyMenuWeekHandler =
  (deps: CopyMenuWeekResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ fromMenuId: unknown; toWeekStartDate: unknown }>,
  ): Promise<GraphQLCopyMenuResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = copyMenuWeekArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { fromMenuId, toWeekStartDate } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const sourceMenu = await findMenuById(client, fromMenuId);
        if (sourceMenu === null) {
          throw new ForbiddenError(DENIAL_MESSAGE);
        }
        await requireHouseholdMember(client, callerUser.id, sourceMenu.householdId);

        // Get-or-create, same household as the source — see this
        // function's own doc above for why this line is the whole point
        // of the slice.
        const targetMenu = await createMenuRepo(client, sourceMenu.householdId, toWeekStartDate);

        let copiedCount = 0;
        let skippedCount = 0;
        for (const day of DAYS_OF_WEEK) {
          const sourceItems = await findMenuItemsForDay(client, sourceMenu.id, day);
          for (const sourceItem of sourceItems) {
            const copied = await tryCopyOneItem(client, targetMenu, day, sourceItem);
            if (copied) {
              copiedCount += 1;
            } else {
              skippedCount += 1;
            }
          }
        }

        const finalItems = await findMenuItems(client, targetMenu.id);
        return {
          menu: toGraphQLMenu(targetMenu, finalItems),
          copiedCount,
          skippedCount,
        };
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createCopyMenuWeekHandler`'s returned function.
export const handler = withErrorHandling(createCopyMenuWeekHandler(productionDeps));
