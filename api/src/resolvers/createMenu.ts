import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { createMenu as createMenuRepo, findMenuItems } from '../repositories/menuRepository.js';
import type { GraphQLMenu } from '../mappers/menu.js';
import { toGraphQLMenu } from '../mappers/menu.js';
import { createMenuArgsSchema } from '../validation/menu.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface CreateMenuResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: CreateMenuResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.createMenu`. Idempotent (W9 S2,
 * E2E_MVP_PLAN.md §15.3): a second call for a household+week that already
 * has a menu returns that SAME menu, never a second row and never a
 * `ConflictError` — opening the Weekly plan screen for a week with no
 * menu yet is the expected first-visit path, not an edge case to reject.
 * Gated by `requireHouseholdMember` first, the same identical-denial-
 * message no-existence-oracle property every other household-scoped
 * resolver has.
 */
export const createCreateMenuHandler =
  (deps: CreateMenuResolverDeps) =>
  async (event: AppSyncResolverEvent<{ householdId: unknown; weekStartDate: unknown }>): Promise<GraphQLMenu> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = createMenuArgsSchema.safeParse(event.arguments);
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

        const menu = await createMenuRepo(client, householdId, weekStartDate);
        const items = await findMenuItems(client, menu.id);
        return toGraphQLMenu(menu, items);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createCreateMenuHandler`'s returned function.
export const handler = withErrorHandling(createCreateMenuHandler(productionDeps));
