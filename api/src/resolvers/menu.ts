import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findMenuByWeek, findMenuItems } from '../repositories/menuRepository.js';
import type { GraphQLMenu } from '../mappers/menu.js';
import { toGraphQLMenu } from '../mappers/menu.js';
import { menuArgsSchema } from '../validation/menu.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface MenuResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: MenuResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.menu`. Reused as the "today's agenda"
 * read path too (E2E_MVP_PLAN.md §15.2.5) — there is no separate server
 * endpoint; the Today screens fetch the current week's `Menu` through this
 * same query and filter `items` by `dayOfWeek` client-side.
 *
 * Returns `null` — not an error, and never an implicit `createMenu` —
 * when no menu exists yet for that household+week (§15.2.5's own "decide
 * and assert" resolution: a pure read). Gated by `requireHouseholdMember`
 * first, the identical-denial-message no-existence-oracle property every
 * other household-scoped resolver has.
 */
export const createMenuHandler =
  (deps: MenuResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; weekStartDate: unknown }>,
  ): Promise<GraphQLMenu | null> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = menuArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, weekStartDate } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const menu = await findMenuByWeek(client, householdId, weekStartDate);
        if (menu === null) {
          return null;
        }
        const items = await findMenuItems(client, menu.id);
        return toGraphQLMenu(menu, items);
      },
      pool,
    );
  };

// See `me.ts`'s identical comment: wraps only the exported production
// handler, not `createMenuHandler`'s returned function.
export const handler = withErrorHandling(createMenuHandler(productionDeps));
