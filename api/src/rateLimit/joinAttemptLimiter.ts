import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { RateLimitedError } from '../errors.js';

/**
 * A generous cap — legitimate users call `joinHousehold` a handful of times
 * a day at most. This exists specifically as an anti-guessing-script measure
 * against the invite code (a 6-character, 31-char-alphabet guessable
 * credential — see `domain/inviteCode.ts`), not as a UX-facing throttle.
 */
export const MAX_JOIN_ATTEMPTS_PER_DAY = 20;

/** ~26 hours: safely past the UTC day boundary so the item expires the day after it stops being written to. */
const TTL_SECONDS_FROM_NOW = 26 * 60 * 60;

const RATE_LIMIT_PK_PREFIX = 'RATELIMIT#joinAttempt#';

const toUtcDateString = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Race-safe increment-with-cap against the shared `cacheTable` (single-table
 * design: `PK = 'RATELIMIT#joinAttempt#' + userId`, `SK = <UTC yyyy-mm-dd>`).
 * One atomic `UpdateItem` call — not a read-then-write — so concurrent calls
 * from the same user in the same day can't race past the cap the way a
 * naive `GetItem` + conditional `PutItem` pair could. Throws
 * `RateLimitedError` on `ConditionalCheckFailedException` (cap already hit
 * for today); any other DynamoDB error propagates unhandled.
 *
 * `now` is injectable (defaults to the real clock) so tests can move across
 * the UTC day boundary without an actual 24-hour wait, without having to
 * fake DynamoDB's own behavior.
 */
export const checkAndIncrementJoinAttempts = async (
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<void> => {
  const currentDate = now();
  const sortKey = toUtcDateString(currentDate);
  const ttl = Math.floor(currentDate.getTime() / 1000) + TTL_SECONDS_FROM_NOW;

  try {
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `${RATE_LIMIT_PK_PREFIX}${userId}`, SK: sortKey },
        UpdateExpression: 'ADD attempts :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(attempts) OR attempts < :max',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':ttl': ttl,
          ':max': MAX_JOIN_ATTEMPTS_PER_DAY,
        },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new RateLimitedError();
    }
    throw error;
  }
};
