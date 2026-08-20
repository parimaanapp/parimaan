import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  insertDefaultSettings as insertDefaultSettingsRepo,
  insertHousehold,
  insertMembership,
} from '../repositories/householdRepository.js';
import type { MembershipRow, SettingsRow } from '../repositories/householdRepository.js';
import type { RandomIntFn } from '../domain/inviteCode.js';
import { attemptWithFreshInviteCode } from '../domain/inviteCodeAttempts.js';
import { toGraphQLHousehold, toGraphQLMembership } from '../mappers/household.js';
import type { GraphQLHousehold } from '../mappers/household.js';
import { toGraphQLUser } from '../mappers/user.js';
import { createHouseholdArgsSchema } from '../validation/createHousehold.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface CreateHouseholdResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable RNG for `generateInviteCode`, for deterministic collision/exhaustion tests. */
  randomInt?: RandomIntFn;
  /**
   * Injectable seam for the default-settings insert step, matching
   * `insertDefaultSettings`'s own signature — defaults to the real
   * repository function. Tests use this to force a mid-transaction failure
   * and assert the whole transaction rolls back (no `households`/
   * `household_memberships` rows survive), the same way `randomInt` above
   * is injected for deterministic collision tests, rather than a test-only
   * boolean branch living in the production code path.
   */
  insertDefaultSettings?: typeof insertDefaultSettingsRepo;
}

export const productionDeps: CreateHouseholdResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.createHousehold`. Flow: validate the
 * caller's identity → validate `{ name }` → resolve/upsert the caller's
 * `users` row (works even if the client never called `me` first) →
 * within a single `withUserTransaction` scope: insert the household (with
 * invite-code retry), then the caller's `primary` membership, then default
 * settings — in that order, because `household_settings`'s RLS policy
 * requires the membership row to already exist. `primaryUserId` is derived
 * exclusively from `identity.sub` (via the resolved `users.id`), never from
 * any mutation argument — there is no such argument on this mutation.
 */
export const createCreateHouseholdHandler =
  (deps: CreateHouseholdResolverDeps) =>
  async (event: AppSyncResolverEvent<{ name: unknown }>): Promise<GraphQLHousehold> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = createHouseholdArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { name } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);
    const graphQLUser = toGraphQLUser(callerUser);

    return withUserTransaction(
      callerUser.id,
      async (txClient) => {
        // Generate-then-insert (not generate-then-UPDATE): `invite_code` is
        // `NOT NULL UNIQUE`, so it cannot be inserted as null and filled in
        // afterward — the retry has to wrap the insert itself.
        const household = await attemptWithFreshInviteCode(
          txClient,
          (inviteCode) =>
            insertHousehold(txClient, { name, inviteCode, primaryUserId: callerUser.id }),
          deps.randomInt,
        );

        const membershipRow: MembershipRow = await insertMembership(txClient, {
          householdId: household.id,
          userId: callerUser.id,
          role: 'primary',
        });

        const insertSettings = deps.insertDefaultSettings ?? insertDefaultSettingsRepo;
        const settings: SettingsRow = await insertSettings(txClient, household.id);

        const membership = toGraphQLMembership(
          { ...membershipRow, household, settings },
          graphQLUser,
        );

        return toGraphQLHousehold(household, [membership], settings);
      },
      pool,
    );
  };

// See `me.ts`'s identical comment: wraps only the exported production
// handler, not `createCreateHouseholdHandler`'s returned function.
export const handler = withErrorHandling(createCreateHouseholdHandler(productionDeps));
