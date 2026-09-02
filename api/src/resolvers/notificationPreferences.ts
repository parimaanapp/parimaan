import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findNotificationPreferences } from '../repositories/notificationPreferencesRepository.js';
import type { GraphQLNotificationPreferences } from '../mappers/notificationPreferences.js';
import { defaultGraphQLNotificationPreferences, toGraphQLNotificationPreferences } from '../mappers/notificationPreferences.js';
import { notificationPreferencesArgsSchema } from '../validation/notificationPreferences.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface NotificationPreferencesResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: NotificationPreferencesResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.notificationPreferences`. Gated by
 * `requireHouseholdMember` first, same identical-denial-message property as
 * every other household-scoped resolver — this can't be used as a
 * household-existence oracle. Always reads the CALLER's own row
 * (`callerUser.id`), never an argument-supplied user id — there is no way
 * to read another member's preferences through this query.
 *
 * A caller with no row yet gets {@link defaultGraphQLNotificationPreferences}
 * — a pure computed default, never an implicit write (E2E_MVP_PLAN.md §14 S8:
 * "decide and assert, don't leave it emergent").
 */
export const createNotificationPreferencesHandler =
  (deps: NotificationPreferencesResolverDeps) =>
  async (event: AppSyncResolverEvent<{ householdId: unknown }>): Promise<GraphQLNotificationPreferences> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = notificationPreferencesArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const row = await findNotificationPreferences(client, callerUser.id, householdId);
        return row === null
          ? defaultGraphQLNotificationPreferences(householdId)
          : toGraphQLNotificationPreferences(row);
      },
      pool,
    );
  };

// See `me.ts`'s identical comment: wraps only the exported production
// handler, not `createNotificationPreferencesHandler`'s returned function.
export const handler = withErrorHandling(createNotificationPreferencesHandler(productionDeps));
