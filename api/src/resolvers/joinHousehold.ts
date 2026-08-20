import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  findHouseholdByInviteCode,
  findMembersForHousehold,
  findMembership as findMembershipRepo,
  findSettingsForHousehold,
  insertMembershipWithinCap as insertMembershipWithinCapRepo,
} from '../repositories/householdRepository.js';
import type { HouseholdRow } from '../repositories/householdRepository.js';
import { toGraphQLHousehold, toGraphQLHouseholdMember } from '../mappers/household.js';
import type { GraphQLHousehold } from '../mappers/household.js';
import { joinHouseholdArgsSchema } from '../validation/joinHousehold.js';
import { HouseholdFullError, NotFoundError, ValidationError } from '../errors.js';
import { isUniqueViolationOnConstraint } from '../db/pgErrors.js';
import { HOUSEHOLD_MEMBER_CAP } from '../domain/householdLimits.js';
import { checkAndIncrementJoinAttempts } from '../rateLimit/joinAttemptLimiter.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * `household_memberships`'s unnamed `UNIQUE(household_id, user_id)`
 * constraint — Postgres's default-generated name, verified empirically
 * against a real Testcontainers run (see `repositories/
 * householdRepository.test.ts`) rather than guessed.
 */
const MEMBERSHIP_UNIQUE_CONSTRAINT = 'household_memberships_household_id_user_id_key';

export interface JoinHouseholdResolverDeps {
  getPool: () => Promise<Pool>;
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  /** Injectable clock for the rate limiter's UTC-day bucketing — see `joinAttemptLimiter.ts`. */
  now?: () => Date;
  /**
   * Injectable seam for the idempotent-rejoin pre-check, matching
   * `findMembership`'s own signature — tests use this to force the
   * pre-check to miss (return `null` even for an existing member) and prove
   * the `23505`-unique-violation fallback in `joinAsMember` below still
   * produces the same idempotent-success behavior on its own, closing the
   * genuine concurrent-double-submit race the pre-check alone cannot.
   */
  findMembership?: typeof findMembershipRepo;
  insertMembershipWithinCap?: typeof insertMembershipWithinCapRepo;
}

let memoizedDdbClient: DynamoDBDocumentClient | undefined;
const getProductionDdbClient = (): DynamoDBDocumentClient => {
  memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return memoizedDdbClient;
};

export const productionDeps: JoinHouseholdResolverDeps = {
  getPool,
  getDdbClient: getProductionDdbClient,
  getCacheTableName: () => loadCacheTableName(),
};

const buildGraphQLHousehold = async (
  client: PoolClient,
  household: HouseholdRow,
): Promise<GraphQLHousehold> => {
  const settings = await findSettingsForHousehold(client, household.id);
  if (settings === null) {
    throw new NotFoundError('Household settings not found.');
  }
  const memberRows = await findMembersForHousehold(client, household.id);
  const members = memberRows.map((row) => toGraphQLHouseholdMember(row, household, settings));
  return toGraphQLHousehold(household, members, settings);
};

/**
 * Adds the caller as a `member`, treating "already a member" as an
 * idempotent no-op success rather than an error — a re-submitted
 * `joinHousehold` call (e.g. a client retry) must not fail just because it
 * already succeeded once. Two layers close this:
 *   1. A `findMembership` pre-check *before* the cap check — so an existing
 *      5th member re-submitting doesn't spuriously get `HouseholdFullError`.
 *   2. A catch around the insert for a `23505` unique-violation on
 *      `household_memberships`'s own uniqueness constraint — the pre-check
 *      alone doesn't close a genuine concurrent-double-submit race (two
 *      requests from the same user landing between the pre-check and the
 *      insert); the constraint is the actual source of truth.
 *
 * Deliberately has NO `requireHouseholdMember` gate anywhere in this
 * resolver — the caller is by definition not yet a member, that's the whole
 * point of this mutation (same as `createHousehold`, which also has none).
 */
const JOIN_INSERT_SAVEPOINT = 'join_household_insert_attempt';

const joinAsMember = async (
  client: PoolClient,
  householdId: string,
  userId: string,
  deps: JoinHouseholdResolverDeps,
): Promise<void> => {
  const findMembership = deps.findMembership ?? findMembershipRepo;
  const insertMembershipWithinCap = deps.insertMembershipWithinCap ?? insertMembershipWithinCapRepo;

  const existing = await findMembership(client, householdId, userId);
  if (existing !== null) {
    return;
  }

  // A unique-violation aborts the *entire* enclosing transaction (every
  // subsequent statement fails until a ROLLBACK) — same hazard
  // `createHousehold.ts`'s `insertHouseholdWithRetry` documents for its own
  // invite-code collision retries. Wrapping just this insert attempt in a
  // SAVEPOINT scopes that abort to the attempt itself, leaving the rest of
  // this transaction (including the settings/members reads that follow)
  // intact.
  await client.query(`SAVEPOINT ${JOIN_INSERT_SAVEPOINT}`);
  let inserted;
  try {
    inserted = await insertMembershipWithinCap(
      client,
      { householdId, userId, role: 'member' },
      HOUSEHOLD_MEMBER_CAP,
    );
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${JOIN_INSERT_SAVEPOINT}`);
    if (isUniqueViolationOnConstraint(error, MEMBERSHIP_UNIQUE_CONSTRAINT)) {
      return;
    }
    throw error;
  }
  await client.query(`RELEASE SAVEPOINT ${JOIN_INSERT_SAVEPOINT}`);
  if (inserted === null) {
    throw new HouseholdFullError();
  }
};

/**
 * Direct-Lambda resolver for `Mutation.joinHousehold`. Flow: validate
 * identity → validate `{ inviteCode }` → resolve/upsert the caller's
 * `users` row → rate-limit the attempt (before any DB lookup of the
 * household itself, so a scripted guesser burns their daily budget on
 * rate-limit checks rather than real household lookups) → within a single
 * `withUserTransaction` scope: lock the target household row (`SELECT ...
 * FOR UPDATE`, the primary concurrency guard against the 5-member cap),
 * join as a member (idempotent), then build and return the full
 * `Household` including its members and settings.
 */
export const createJoinHouseholdHandler =
  (deps: JoinHouseholdResolverDeps) =>
  async (event: AppSyncResolverEvent<{ inviteCode: unknown }>): Promise<GraphQLHousehold> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = joinHouseholdArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { inviteCode } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    await checkAndIncrementJoinAttempts(
      deps.getDdbClient(),
      deps.getCacheTableName(),
      callerUser.id,
      deps.now,
    );

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const household = await findHouseholdByInviteCode(client, inviteCode, { forUpdate: true });
        if (household === null) {
          throw new NotFoundError('Invalid invite code.');
        }

        await joinAsMember(client, household.id, callerUser.id, deps);

        return buildGraphQLHousehold(client, household);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createJoinHouseholdHandler`'s returned function.
export const handler = withErrorHandling(createJoinHouseholdHandler(productionDeps));
