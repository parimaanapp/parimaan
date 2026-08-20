import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  findHouseholdById,
  updateInviteCode as updateInviteCodeRepo,
} from '../repositories/householdRepository.js';
import type { HouseholdRow } from '../repositories/householdRepository.js';
import type { GraphQLHousehold } from '../mappers/household.js';
import type { RandomIntFn } from '../domain/inviteCode.js';
import { attemptWithFreshInviteCode } from '../domain/inviteCodeAttempts.js';
import { rotateInviteCodeArgsSchema } from '../validation/rotateInviteCode.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { buildGraphQLHousehold } from './householdView.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * Tighter than `joinHousehold`'s 20/day because the shape of the abuse is
 * different: rotating is a *destructive* action for co-members (every
 * previously-shared code stops working the instant it succeeds), so a
 * compromised or malicious member spamming it is a denial-of-service against
 * their own household. Ten a day is far beyond any legitimate use — a
 * household rotates its code when it leaks, not routinely.
 */
export const MAX_ROTATE_ATTEMPTS_PER_DAY = 10;

/**
 * The action name this resolver's DynamoDB rate-limit partition key is built
 * from (`RATELIMIT#rotateAttempt#<userId>`). FROZEN once deployed, for the
 * same reason `joinAttemptLimiter.ts`'s own action name is — see that file.
 */
const ROTATE_ATTEMPT_ACTION = 'rotateAttempt';

/**
 * How many extra passes to spend when a freshly-minted code happens to equal
 * the code being replaced. One extra pass is enough: the odds of drawing the
 * same code twice from an ~887M-code keyspace are not a scenario worth
 * looping over, and the caller can simply rotate again.
 */
const SAME_CODE_RETRIES = 1;

export interface RotateInviteCodeResolverDeps {
  getPool: () => Promise<Pool>;
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  /** Injectable clock for the rate limiter's UTC-day bucketing — see `dailyActionLimiter.ts`. */
  now?: () => Date;
  /** Injectable RNG for `generateInviteCode`, for deterministic same-code/collision/exhaustion tests. */
  randomInt?: RandomIntFn;
  /**
   * Injectable seam for the write step, matching `updateInviteCode`'s own
   * signature — tests use it to force a same-code or no-row-matched outcome
   * without having to win a real race, the same way `joinHousehold` injects
   * `findMembership` to force its own pre-check to miss.
   */
  updateInviteCode?: typeof updateInviteCodeRepo;
}

let memoizedDdbClient: DynamoDBDocumentClient | undefined;
const getProductionDdbClient = (): DynamoDBDocumentClient => {
  memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return memoizedDdbClient;
};

export const productionDeps: RotateInviteCodeResolverDeps = {
  getPool,
  getDdbClient: getProductionDdbClient,
  getCacheTableName: () => loadCacheTableName(),
};

/**
 * Writes a freshly-minted invite code onto `household`, guaranteeing the
 * result differs from the code being replaced. Invite-code *collisions*
 * (another household already holds the minted code) are retried by
 * `attemptWithFreshInviteCode` exactly as `createHousehold` does; the
 * distinct "minted the same code we're replacing" case cannot be a `23505`
 * at all — Postgres does not consider a row to conflict with itself — so it
 * is detected here explicitly and answered with another full pass.
 *
 * A `null` from the write is treated as "mint again" for both of its
 * meanings (same-code sentinel, or no row matched `householdId`). The second
 * is unreachable in practice: `requireHouseholdMember` has already proven
 * the household exists, inside this same transaction.
 */
const rotateToFreshCode = async (
  client: PoolClient,
  household: HouseholdRow,
  deps: RotateInviteCodeResolverDeps,
): Promise<HouseholdRow> => {
  const updateInviteCode = deps.updateInviteCode ?? updateInviteCodeRepo;

  for (let pass = 0; pass <= SAME_CODE_RETRIES; pass += 1) {
    const updated = await attemptWithFreshInviteCode(
      client,
      (inviteCode) =>
        inviteCode === household.inviteCode
          ? Promise.resolve(null)
          : updateInviteCode(client, household.id, inviteCode),
      deps.randomInt,
    );
    if (updated !== null) {
      return updated;
    }
  }

  throw new Error('Failed to generate an invite code different from the current one.');
};

/**
 * Direct-Lambda resolver for `Mutation.rotateInviteCode`. Flow: validate
 * identity → validate `{ householdId }` → resolve/upsert the caller's `users`
 * row → rate-limit the attempt (before opening the transaction, matching
 * `joinHousehold`'s rationale: the cheap check runs before the expensive
 * work) → within a single `withUserTransaction` scope: `requireHouseholdMember`
 * (ANY member may rotate — there is deliberately no role check, per this
 * product's "any member can do everything" trust model), mint and write a
 * replacement code, then return the full rehydrated `Household`.
 *
 * Not idempotent, unlike `joinHousehold`: every successful call invalidates
 * the previous code for everyone holding it. That is the entire point of the
 * mutation, and why it is rate-limited more tightly than joining.
 */
export const createRotateInviteCodeHandler =
  (deps: RotateInviteCodeResolverDeps) =>
  async (event: AppSyncResolverEvent<{ householdId: unknown }>): Promise<GraphQLHousehold> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = rotateInviteCodeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    await checkAndIncrementDailyAction(
      deps.getDdbClient(),
      deps.getCacheTableName(),
      ROTATE_ATTEMPT_ACTION,
      callerUser.id,
      MAX_ROTATE_ATTEMPTS_PER_DAY,
      deps.now,
    );

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const household = await findHouseholdById(client, householdId);
        if (household === null) {
          // Unreachable: membership rows FK-reference households, so
          // requireHouseholdMember passing implies the row exists.
          throw new NotFoundError('Household not found.');
        }

        const rotated = await rotateToFreshCode(client, household, deps);
        return buildGraphQLHousehold(client, rotated);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createRotateInviteCodeHandler`'s returned function.
export const handler = withErrorHandling(createRotateInviteCodeHandler(productionDeps));
