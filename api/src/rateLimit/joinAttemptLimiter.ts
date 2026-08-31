import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { checkAndIncrementDailyAction } from './dailyActionLimiter.js';

/**
 * A generous cap — legitimate users call `joinHousehold` a handful of times
 * a day at most. This exists specifically as an anti-guessing-script measure
 * against the invite code (a 6-character, 31-char-alphabet guessable
 * credential — see `domain/inviteCode.ts`), not as a UX-facing throttle.
 */
export const MAX_JOIN_ATTEMPTS_PER_DAY = 20;

/**
 * The action name this limiter's DynamoDB partition key is built from.
 * FROZEN: it is baked into every live counter item already written as
 * `RATELIMIT#joinAttempt#<userId>`. Renaming it would orphan those items and
 * silently hand every in-flight abuser a fresh daily budget.
 */
const JOIN_ATTEMPT_ACTION = 'joinAttempt';

/**
 * `joinHousehold`'s per-caller daily attempt limit — a thin, named wrapper
 * over the shared `checkAndIncrementDailyAction` counter (see
 * `dailyActionLimiter.ts` for the atomic-increment/UTC-bucketing mechanics).
 * Kept as its own function rather than inlined at the call site so the
 * action name and the cap stay bound together in one place, and so callers
 * cannot accidentally pass a different cap for the same action.
 */
export const checkAndIncrementJoinAttempts = async (
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
  now?: () => Date,
): Promise<void> =>
  checkAndIncrementDailyAction(
    ddbClient,
    tableName,
    JOIN_ATTEMPT_ACTION,
    userId,
    MAX_JOIN_ATTEMPTS_PER_DAY,
    'Too many join attempts. Try again tomorrow.',
    now,
  );
