import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { RateLimitedError, UnauthorizedError } from '../errors.js';
import { isOwnPantryPhotoKey } from '../uploads/pantryPhotoKey.js';
import { createGetPantryPhotoUploadUrlHandler, MAX_PHOTO_UPLOAD_URLS_PER_DAY } from './getPantryPhotoUploadUrl.js';
import type { GetPantryPhotoUploadUrlResolverDeps } from './getPantryPhotoUploadUrl.js';

const s3 = new S3Client({ region: 'ap-south-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });

const identityFor = (sub: string | null): AppSyncResolverEvent<unknown>['identity'] =>
  sub === null
    ? null
    : ({
        sub,
        issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
        username: sub,
        claims: { email: `${sub}@example.test` },
        sourceIp: ['127.0.0.1'],
        defaultAuthStrategy: 'ALLOW',
        groups: null,
      } as unknown as AppSyncResolverEvent<unknown>['identity']);

const buildEvent = (sub: string | null): AppSyncResolverEvent<Record<string, never>> => ({
  arguments: {},
  identity: identityFor(sub),
  source: null,
  request: { headers: {}, domainName: null },
  info: { selectionSetList: [], selectionSetGraphQL: '', parentTypeName: 'Mutation', fieldName: 'getPantryPhotoUploadUrl', variables: {} },
  prev: null,
  stash: {},
});

describe('getPantryPhotoUploadUrl resolver (Mutation.getPantryPhotoUploadUrl)', () => {
  let ddb: TestDynamoDb;

  beforeAll(async () => {
    ddb = await startTestDynamoDb();
  }, 120_000);

  afterAll(async () => {
    await ddb.stop();
  });

  const deps = (over: Partial<GetPantryPhotoUploadUrlResolverDeps> = {}): GetPantryPhotoUploadUrlResolverDeps => ({
    getBucketName: () => 'parimaan-uploads-test',
    getS3Client: () => s3,
    getDdbClient: () => ddb.client,
    getCacheTableName: () => ddb.tableName,
    now: () => new Date('2026-09-28T10:00:00.000Z'),
    ...over,
  });

  it('rejects an unauthenticated caller before touching S3 or the rate limiter', async () => {
    await expect(createGetPantryPhotoUploadUrlHandler(deps())(buildEvent(null))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns a URL, a caller-scoped key that S4 will accept as the caller\'s own, and an expiry', async () => {
    const sub = randomUUID();
    const result = await createGetPantryPhotoUploadUrlHandler(deps())(buildEvent(sub));

    expect(isOwnPantryPhotoKey(sub, result.s3Key)).toBe(true);
    expect(result.url).toContain('parimaan-uploads-test');
    expect(result.expiresAt).toBe('2026-09-28T10:05:00.000Z');
  });

  it("never hands out another caller's prefix, and a fresh key every call", async () => {
    const subA = randomUUID();
    const subB = randomUUID();
    const handler = createGetPantryPhotoUploadUrlHandler(deps());
    const a1 = await handler(buildEvent(subA));
    const a2 = await handler(buildEvent(subA));
    const b = await handler(buildEvent(subB));

    expect(a1.s3Key).not.toBe(a2.s3Key);
    expect(isOwnPantryPhotoKey(subA, b.s3Key)).toBe(false);
    expect(isOwnPantryPhotoKey(subB, b.s3Key)).toBe(true);
  });

  it('caps URLs per user per day so the bucket cannot be used as free storage', async () => {
    const sub = randomUUID();
    const handler = createGetPantryPhotoUploadUrlHandler(deps());
    for (let i = 0; i < MAX_PHOTO_UPLOAD_URLS_PER_DAY; i++) {
      await handler(buildEvent(sub));
    }

    await expect(handler(buildEvent(sub))).rejects.toBeInstanceOf(RateLimitedError);
    await expect(handler(buildEvent(sub))).rejects.toThrow(/photo uploads/i);
  }, 60_000);
});
