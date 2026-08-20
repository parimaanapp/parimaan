import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { MAX_JOIN_ATTEMPTS_PER_DAY, checkAndIncrementJoinAttempts } from './joinAttemptLimiter.js';
import { RateLimitedError } from '../errors.js';

describe('checkAndIncrementJoinAttempts', () => {
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

  it('allows the first N=20 calls in a day and rejects the 21st', async () => {
    const userId = randomUUID();
    const now = fixedNow();

    for (let i = 0; i < MAX_JOIN_ATTEMPTS_PER_DAY; i += 1) {
      await expect(
        checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, now),
      ).resolves.toBeUndefined();
    }

    await expect(
      checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, now),
    ).rejects.toThrow(RateLimitedError);
  });

  it('isolates attempts by userId — a different user on the same day is unaffected', async () => {
    const exhaustedUser = randomUUID();
    const freshUser = randomUUID();
    const now = fixedNow();

    for (let i = 0; i < MAX_JOIN_ATTEMPTS_PER_DAY; i += 1) {
      await checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, exhaustedUser, now);
    }
    await expect(
      checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, exhaustedUser, now),
    ).rejects.toThrow(RateLimitedError);

    await expect(
      checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, freshUser, now),
    ).resolves.toBeUndefined();
  });

  it('resets the counter on a subsequent UTC day', async () => {
    const userId = randomUUID();
    const day1 = (): Date => new Date('2026-08-19T23:59:00.000Z');
    const day2 = (): Date => new Date('2026-08-20T00:01:00.000Z');

    for (let i = 0; i < MAX_JOIN_ATTEMPTS_PER_DAY; i += 1) {
      await checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, day1);
    }
    await expect(
      checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, day1),
    ).rejects.toThrow(RateLimitedError);

    // A new UTC day is a fresh SK ('yyyy-mm-dd') — the counter resets.
    await expect(
      checkAndIncrementJoinAttempts(ddb.client, ddb.tableName, userId, day2),
    ).resolves.toBeUndefined();
  });
});
