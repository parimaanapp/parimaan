import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { RateLimitedError } from '../errors.js';

/** ~26 hours: safely past the UTC day boundary so the item expires the day after it stops being written to. */
const TTL_SECONDS_FROM_NOW = 26 * 60 * 60;

const RATE_LIMIT_PK_PREFIX = 'RATELIMIT#';

const toUtcDateString = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The shared per-caller, per-UTC-day counter behind every rate limit in this
 * codebase. Race-safe increment-with-cap against the `cacheTable`
 * (single-table design: `PK = 'RATELIMIT#' + action + '#' + userId`,
 * `SK = <UTC yyyy-mm-dd>`). One atomic `UpdateItem` call — not a
 * read-then-write — so concurrent calls from the same user in the same day
 * can't race past `max` the way a naive `GetItem` + conditional `PutItem`
 * pair could. Throws `RateLimitedError` on
 * `ConditionalCheckFailedException` (cap already hit for today); any other
 * DynamoDB error propagates unhandled.
 *
 * `action` is what keeps one limited mutation from consuming another's
 * budget — each action name gets its own independent partition per user.
 * Existing action names are load-bearing production data: changing one
 * orphans every live counter written under the old key, so treat them as
 * frozen strings, not cosmetic labels.
 *
 * `rateLimitedMessage` is the exact `RateLimitedError.message` a caller
 * hitting *this* action's own cap sees — required, not defaulted (W7 S12
 * finding: a shared bare-constructor default here previously leaked one
 * caller's copy to every other caller sharing this function). Write it for
 * the action this call site actually rate-limits, not a generic sentence.
 *
 * `now` is injectable (defaults to the real clock) so tests can move across
 * the UTC day boundary without an actual 24-hour wait, without having to
 * fake DynamoDB's own behavior.
 */
export const checkAndIncrementDailyAction = async (
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  action: string,
  userId: string,
  max: number,
  rateLimitedMessage: string,
  now: () => Date = () => new Date(),
): Promise<void> => {
  const currentDate = now();
  const sortKey = toUtcDateString(currentDate);
  const ttl = Math.floor(currentDate.getTime() / 1000) + TTL_SECONDS_FROM_NOW;

  try {
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `${RATE_LIMIT_PK_PREFIX}${action}#${userId}`, SK: sortKey },
        UpdateExpression: 'ADD attempts :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(attempts) OR attempts < :max',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':ttl': ttl,
          ':max': max,
        },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new RateLimitedError(rateLimitedMessage);
    }
    throw error;
  }
};
