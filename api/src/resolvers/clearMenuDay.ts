import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { deleteMenuItemsByIds, findMenuById, findMenuItemsForDay, lockMenu } from '../repositories/menuRepository.js';
import type { GraphQLClearMenuResult } from '../mappers/menu.js';
import { clearMenuDayArgsSchema } from '../validation/menu.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface ClearMenuDayResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: ClearMenuDayResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.clearMenuDay` (W14 S8,
 * E2E_MVP_PLAN.md §20.2.8/§20.3, D8). Deletes every `MenuItem` on
 * `dayOfWeek` of `menuId`'s menu EXCEPT one with `madeAt` set — the exact
 * "never delete a cooked item" invariant `autoFillWeek`'s `overwrite: true`
 * already locked (`deleteUnmadeMenuItems`'s own comment) — and reports both
 * halves honestly via `clearedCount`/`preservedCount`, matching
 * `AutoFillResult`'s never-a-silent-partial-result posture.
 *
 * Gated identically to `addMenuItem`/`autoFillWeek`: `menuId` resolves the
 * household via `findMenuById` (RLS-scoped, so a menu in another household
 * comes back `null` identical to a genuinely nonexistent one), then
 * `requireHouseholdMember` throws the byte-identical denial either way —
 * no existence oracle. Takes the menu-scoped `lockMenu` before reading, the
 * same lock ordering every other menu-item-touching resolver uses
 * (§16.2.6) — a concurrent `addMenuItem`/`autoFillWeek` can't race this
 * delete.
 */
export const createClearMenuDayHandler =
  (deps: ClearMenuDayResolverDeps) =>
  async (event: AppSyncResolverEvent<{ menuId: unknown; dayOfWeek: unknown }>): Promise<GraphQLClearMenuResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = clearMenuDayArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { menuId, dayOfWeek } = parsedArgs.data;

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

        const items = await findMenuItemsForDay(client, menuId, dayOfWeek);
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
// production handler, not `createClearMenuDayHandler`'s returned function.
export const handler = withErrorHandling(createClearMenuDayHandler(productionDeps));
