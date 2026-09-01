import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { upsertNotificationPreferencesPartial } from '../repositories/notificationPreferencesRepository.js';
import type { NotificationPreferencesPatch } from '../repositories/notificationPreferencesRepository.js';
import type { GraphQLNotificationPreferences } from '../mappers/notificationPreferences.js';
import { toGraphQLNotificationPreferences } from '../mappers/notificationPreferences.js';
import {
  updateNotificationPreferencesArgsSchema,
} from '../validation/notificationPreferences.js';
import type { NotificationPreferencesPatchInput } from '../validation/notificationPreferences.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * Zod's optional fields are typed as `T | undefined`, but
 * `NotificationPreferencesPatch` (under this repo's
 * `exactOptionalPropertyTypes`) requires absent-not-set rather than
 * present-and-undefined — same helper shape as
 * `updateHouseholdSettings.ts`'s `toSettingsPatch`.
 */
const toNotificationPreferencesPatch = (
  input: NotificationPreferencesPatchInput,
): NotificationPreferencesPatch => {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as NotificationPreferencesPatch;
};

export interface UpdateNotificationPreferencesResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: UpdateNotificationPreferencesResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.updateNotificationPreferences`. Flow:
 * validate identity → validate `{ householdId, input }` (Zod, including the
 * "at least one field present" refinement) BEFORE touching the database →
 * resolve/upsert the caller's `users` row → within a single
 * `withUserTransaction` scope: `requireHouseholdMember` (the primary
 * authorization gate), then a single upsert-or-patch via
 * `upsertNotificationPreferencesPartial`.
 *
 * Always writes the CALLER's own `(userId, householdId)` row — there is no
 * argument for a target user, so there is no way to patch another member's
 * preferences through this mutation. The first successful call for a pair
 * both creates and applies the patch in one statement (see the repository
 * function's own comment); every call after that is a genuine partial
 * update.
 */
export const createUpdateNotificationPreferencesHandler =
  (deps: UpdateNotificationPreferencesResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; input: unknown }>,
  ): Promise<GraphQLNotificationPreferences> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = updateNotificationPreferencesArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, input } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const patch = toNotificationPreferencesPatch(input);
        const row = await upsertNotificationPreferencesPartial(client, callerUser.id, householdId, patch);
        return toGraphQLNotificationPreferences(row);
      },
      pool,
    );
  };

// See `updateHouseholdSettings.ts`'s identical comment: wraps only the
// exported production handler, not the returned function itself.
export const handler = withErrorHandling(createUpdateNotificationPreferencesHandler(productionDeps));
