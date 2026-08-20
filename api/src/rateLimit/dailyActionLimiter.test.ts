import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { checkAndIncrementDailyAction } from './dailyActionLimiter.js';
import { MAX_JOIN_ATTEMPTS_PER_DAY, checkAndIncrementJoinAttempts } from './joinAttemptLimiter.js';
import { RateLimitedError } from '../errors.js';

describe('checkAndIncrementDailyAction', () => {
  let ddb: TestDynamoDb;

  beforeAll(async () => {
    ddb = await startTestDynamoDb();
  }, 120_000);

  afterAll(async () => {
    await ddb.stop();
  });

  const fixedNow = (): (() => Date) => {
    const date = new Date('2026-08-19T12:00:00.000Z');
    return () => date;
  };

  const readItem = async (pk: string, sk: string): Promise<Record<string, unknown> | undefined> => {
    const result = await ddb.client.send(
      new GetCommand({ TableName: ddb.tableName, Key: { PK: pk, SK: sk } }),
    );
    return result.Item;
  };

  it('allows the first `max` calls in a day and rejects the next one', async () => {
    const userId = randomUUID();
    const now = fixedNow();

    for (let i = 0; i < 3; i += 1) {
      await expect(
        checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'testAction', userId, 3, now),
      ).resolves.toBeUndefined();
    }

    await expect(
      checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'testAction', userId, 3, now),
    ).rejects.toThrow(RateLimitedError);
  });

  it('isolates budgets by action — exhausting one action leaves another untouched for the same user', async () => {
    const userId = randomUUID();
    const now = fixedNow();

    for (let i = 0; i < 2; i += 1) {
      await checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'actionA', userId, 2, now);
    }
    await expect(
      checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'actionA', userId, 2, now),
    ).rejects.toThrow(RateLimitedError);

    await expect(
      checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'actionB', userId, 2, now),
    ).resolves.toBeUndefined();
  });

  it('isolates budgets by userId — a different user on the same day and action is unaffected', async () => {
    const exhaustedUser = randomUUID();
    const freshUser = randomUUID();
    const now = fixedNow();

    await checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'sharedAction', exhaustedUser, 1, now);
    await expect(
      checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'sharedAction', exhaustedUser, 1, now),
    ).rejects.toThrow(RateLimitedError);

    await expect(
      checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'sharedAction', freshUser, 1, now),
    ).resolves.toBeUndefined();
  });

  it('resets the counter on a subsequent UTC day', async () => {
    const userId = randomUUID();
    const day1 = (): Date => new Date('2026-08-19T23:59:00.000Z');
    const day2 = (): Date => new Date('2026-08-20T00:01:00.000Z');

    await checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'dayAction', userId, 1, day1);
    await expect(
      checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'dayAction', userId, 1, day1),
    ).rejects.toThrow(RateLimitedError);

    await expect(
      checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'dayAction', userId, 1, day2),
    ).resolves.toBeUndefined();
  });

  it('writes the counter under PK `RATELIMIT#<action>#<userId>` with the UTC date as SK, plus a TTL', async () => {
    const userId = randomUUID();
    const now = fixedNow();

    await checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'keyShapeAction', userId, 5, now);

    const item = await readItem(`RATELIMIT#keyShapeAction#${userId}`, '2026-08-19');
    expect(item).toBeDefined();
    expect(item?.['attempts']).toBe(1);
    expect(typeof item?.['ttl']).toBe('number');
  });

  it('KEY-COMPATIBILITY: checkAndIncrementJoinAttempts still writes the exact legacy PK `RATELIMIT#joinAttempt#<userId>`', async () => {
    // Load-bearing regression guard for the refactor that turned
    // `joinAttemptLimiter` into a wrapper over this module: the produced
    // DynamoDB key must be byte-identical to what shipped before, or every
    // live rate-limit counter in production is orphaned and every in-flight
    // abuser silently gets a fresh daily budget.
    const userId = randomUUID();
    const now = fixedNow();

    await checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, now);

    const item = await readItem(`RATELIMIT#joinAttempt#${userId}`, '2026-08-19');
    expect(item).toBeDefined();
    expect(item?.['PK']).toBe(`RATELIMIT#joinAttempt#${userId}`);
    expect(item?.['SK']).toBe('2026-08-19');
    expect(item?.['attempts']).toBe(1);
  });

  it('KEY-COMPATIBILITY: the join-attempt wrapper enforces MAX_JOIN_ATTEMPTS_PER_DAY, not some other cap', async () => {
    const userId = randomUUID();
    const now = fixedNow();

    for (let i = 0; i < MAX_JOIN_ATTEMPTS_PER_DAY; i += 1) {
      await checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, now);
    }
    await expect(
      checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, now),
    ).rejects.toThrow(RateLimitedError);
  });
});
