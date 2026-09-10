import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { deleteMenuItemsByIds, findMenuById, findMenuItems, lockMenu } from '../repositories/menuRepository.js';
import type { GraphQLClearMenuResult } from '../mappers/menu.js';
import { clearMenuWeekArgsSchema } from '../validation/menu.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface ClearMenuWeekResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: ClearMenuWeekResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.clearMenuWeek` (W14 S8,
 * E2E_MVP_PLAN.md §20.2.8/§20.3, D8) — `clearMenuDay` widened to every day
 * of `menuId`'s menu in one call, identical "never delete a cooked item"
 * invariant, identical honest `clearedCount`/`preservedCount` reporting.
 * Deliberately reuses `findMenuItems` (the whole-menu read `createMenu`/
 * `autoFillWeek` already use) rather than looping `findMenuItemsForDay`
 * seven times — one round trip, filtered once, not seven.
 *
 * Gating and lock ordering identical to `clearMenuDay` — see that
 * resolver's own comment.
 */
export const createClearMenuWeekHandler =
  (deps: ClearMenuWeekResolverDeps) =>
  async (event: AppSyncResolverEvent<{ menuId: unknown }>): Promise<GraphQLClearMenuResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = clearMenuWeekArgsSchema.safeParse(event.arguments);
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

        await lockMenu(client, menuId);

        const items = await findMenuItems(client, menuId);
        const toClear = items.filter((item) => item.madeAt === null);
        const preservedCount = items.length - toClear.length;

        const clearedCount = await deleteMenuItemsByIds(
          client,
          toClear.map((item) => item.id),
        );

        return { clearedCount, preservedCount };
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createClearMenuWeekHandler`'s returned function.
export const handler = withErrorHandling(createClearMenuWeekHandler(productionDeps));
