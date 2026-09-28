import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { AiTimeoutError, ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, ValidationError } from '../errors.js';
import { VISION_DEADLINE_MS } from '../ai/invokeModel.js';
import { buildPantryPhotoKey } from '../uploads/pantryPhotoKey.js';
import { MAX_PANTRY_PHOTO_BYTES } from '../uploads/pantryPhotoStore.js';
import type { PantryPhotoObjectInfo, PantryPhotoStore } from '../uploads/pantryPhotoStore.js';
import { createAnalyzePantryPhotoHandler, MAX_PHOTO_ANALYSES_PER_DAY } from './analyzePantryPhoto.js';
import type { AnalyzePantryPhotoResolverDeps } from './analyzePantryPhoto.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const identityFor = (sub: string | null): AppSyncResolverEvent<unknown>['identity'] =>
  sub === null
    ? null
    : ({ sub, issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake', username: sub, claims: { email: `${sub}@example.test` }, sourceIp: ['127.0.0.1'], defaultAuthStrategy: 'ALLOW', groups: null } as unknown as AppSyncResolverEvent<unknown>['identity']);

const eventFor = (sub: string | null, s3Key: unknown): AppSyncResolverEvent<{ s3Key: unknown }> => ({
  arguments: { s3Key },
  identity: identityFor(sub),
  source: null,
  request: { headers: {}, domainName: null },
  info: { selectionSetList: [], selectionSetGraphQL: '', parentTypeName: 'Mutation', fieldName: 'analyzePantryPhoto', variables: {} },
  prev: null,
  stash: {},
});

interface FakeStoreOptions {
  info?: PantryPhotoObjectInfo | null;
  bytes?: Uint8Array;
  deleteFails?: boolean;
}
const fakeStore = (options: FakeStoreOptions = {}) => {
  const calls: string[] = [];
  const store: PantryPhotoStore = {
    head: (key) => {
      calls.push(`head:${key}`);
      return Promise.resolve(options.info === undefined ? { contentLength: JPEG.length, contentType: 'image/jpeg' } : options.info);
    },
    getBytes: (key, max) => {
      calls.push(`get:${key}:${String(max)}`);
      return Promise.resolve(options.bytes ?? JPEG);
    },
    delete: (key) => {
      calls.push(`delete:${key}`);
      return options.deleteFails === true ? Promise.reject(new Error('s3 down')) : Promise.resolve();
    },
  };
  return { store, calls };
};

const modelItems = [
  { name: 'Toor Dal', quantity: 1, unit: 'jar', category: 'dal', confidence: 'high' },
  { name: 'Spice Jar', quantity: 1, unit: 'jar', category: 'spice', confidence: 'low' },
];

describe('analyzePantryPhoto resolver (Mutation.analyzePantryPhoto)', () => {
  let ddb: TestDynamoDb;
  beforeAll(async () => {
    ddb = await startTestDynamoDb();
  }, 120_000);
  afterAll(async () => {
    await ddb.stop();
  });

  const setup = (over: { store?: FakeStoreOptions; invoke?: AnalyzePantryPhotoResolverDeps['invoke'] } = {}) => {
    const { store, calls } = fakeStore(over.store);
    const invoke = vi.fn(over.invoke ?? (() => Promise.resolve(modelItems)));
    const metrics: unknown[] = [];
    const deps: AnalyzePantryPhotoResolverDeps = {
      getStore: () => store,
      getDdbClient: () => ddb.client,
      getCacheTableName: () => ddb.tableName,
      invoke: invoke as unknown as NonNullable<AnalyzePantryPhotoResolverDeps['invoke']>,
      emitMetric: (summary) => metrics.push(summary),
      logError: () => undefined,
    };
    const sub = randomUUID();
    const key = buildPantryPhotoKey(sub, randomUUID());
    return { handler: createAnalyzePantryPhotoHandler(deps), sub, key, calls, invoke, metrics };
  };

  describe('who and what', () => {
    it('rejects an unauthenticated caller before touching S3', async () => {
      const t = setup();
      await expect(t.handler(eventFor(null, t.key))).rejects.toBeInstanceOf(UnauthorizedError);
      expect(t.calls).toEqual([]);
    });

    it.each([undefined, null, 5, ''])('rejects a malformed s3Key (%s) with a validation error and no S3 call', async (bad) => {
      const t = setup();
      await expect(t.handler(eventFor(t.sub, bad))).rejects.toBeInstanceOf(ValidationError);
      expect(t.calls).toEqual([]);
    });

    it("refuses another user's key — before any S3 call, before any quota, before the model", async () => {
      const t = setup();
      const others = buildPantryPhotoKey(randomUUID(), randomUUID());
      await expect(t.handler(eventFor(t.sub, others))).rejects.toBeInstanceOf(ForbiddenError);
      expect(t.calls).toEqual([]);
      expect(t.invoke).not.toHaveBeenCalled();
    });

    it('refuses a traversal attempt shaped like the caller\'s own prefix', async () => {
      const t = setup();
      await expect(t.handler(eventFor(t.sub, `pantry-photos/${t.sub}/../${randomUUID()}/x.jpg`))).rejects.toBeInstanceOf(ForbiddenError);
      expect(t.calls).toEqual([]);
    });
  });

  describe('validating the object — nothing here may consume quota or reach the model', () => {
    it('a missing photo is NotFound, and there is nothing to delete', async () => {
      const t = setup({ store: { info: null } });
      await expect(t.handler(eventFor(t.sub, t.key))).rejects.toBeInstanceOf(NotFoundError);
      expect(t.invoke).not.toHaveBeenCalled();
      expect(t.calls).toEqual([`head:${t.key}`]);
    });

    it.each([
      ['oversize', { contentLength: MAX_PANTRY_PHOTO_BYTES + 1, contentType: 'image/jpeg' }],
      ['empty', { contentLength: 0, contentType: 'image/jpeg' }],
      ['the wrong content type', { contentLength: 100, contentType: 'image/png' }],
      ['a missing content type', { contentLength: 100, contentType: undefined }],
    ])('rejects %s, deletes the object, never reads or analyzes it', async (_label, info) => {
      const t = setup({ store: { info } });
      await expect(t.handler(eventFor(t.sub, t.key))).rejects.toBeInstanceOf(ValidationError);
      expect(t.invoke).not.toHaveBeenCalled();
      expect(t.calls).toEqual([`head:${t.key}`, `delete:${t.key}`]);
    });

    it('rejects bytes that are not a JPEG even when the client-supplied content type said so', async () => {
      const t = setup({ store: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]) } });
      await expect(t.handler(eventFor(t.sub, t.key))).rejects.toBeInstanceOf(ValidationError);
      expect(t.invoke).not.toHaveBeenCalled();
      expect(t.calls.at(-1)).toBe(`delete:${t.key}`);
    });

    it('rejects an object swapped for an oversize one between the size check and the read', async () => {
      const t = setup({ store: { bytes: new Uint8Array(MAX_PANTRY_PHOTO_BYTES + 1).fill(0xff) } });
      await expect(t.handler(eventFor(t.sub, t.key))).rejects.toBeInstanceOf(ValidationError);
      expect(t.invoke).not.toHaveBeenCalled();
    });

    it('a rejected photo does not count against the daily limit', async () => {
      const t = setup({ store: { info: { contentLength: MAX_PANTRY_PHOTO_BYTES + 1, contentType: 'image/jpeg' } } });
      for (let i = 0; i < MAX_PHOTO_ANALYSES_PER_DAY + 2; i++) {
        await expect(t.handler(eventFor(t.sub, t.key))).rejects.toBeInstanceOf(ValidationError);
      }
    }, 60_000);
  });

  describe('the analysis', () => {
    it('sends the photo to the vision model with the vision deadline, the app prompt, an output cap and the exact bytes', async () => {
      const t = setup();
      await t.handler(eventFor(t.sub, t.key));

      const [prompt, options] = t.invoke.mock.calls[0]! as unknown as [string, { deadlineMs: number; maxOutputTokens: number; images: Array<{ mimeType: string; base64Data: string }> }];
      expect(prompt).toContain('dry_goods');
      expect(options.deadlineMs).toBe(VISION_DEADLINE_MS);
      expect(options.maxOutputTokens).toBe(2048);
      expect(options.images).toEqual([{ mimeType: 'image/jpeg', base64Data: Buffer.from(JPEG).toString('base64') }]);
    });

    it('reads with a cap of MAX bytes, and returns converted proposals — junk dropped, counts reported', async () => {
      const t = setup();
      const result = await t.handler(eventFor(t.sub, t.key));

      expect(t.calls).toContain(`get:${t.key}:${String(MAX_PANTRY_PHOTO_BYTES)}`);
      expect(result.items.map((i) => i.name)).toEqual(['Toor Dal']);
      expect(result).toMatchObject({ droppedCount: 1, truncated: false });
    });

    it('deletes the photo after a successful analysis, and emits the analysis metric', async () => {
      const t = setup();
      await t.handler(eventFor(t.sub, t.key));

      expect(t.calls.at(-1)).toBe(`delete:${t.key}`);
      expect(t.metrics).toEqual([expect.objectContaining({ itemsProposed: 1, itemsDropped: 1, highConfidenceItems: 1, truncated: false })]);
    });

    it('still deletes the photo — and still spent the quota — when the model fails', async () => {
      const t = setup({ invoke: () => Promise.reject(new AiTimeoutError()) });
      await expect(t.handler(eventFor(t.sub, t.key))).rejects.toBeInstanceOf(AiTimeoutError);
      expect(t.calls.at(-1)).toBe(`delete:${t.key}`);
      expect(t.metrics).toEqual([]);
    });

    it('a failed cleanup delete never fails the request — the 1-day lifecycle rule is the backstop', async () => {
      const t = setup({ store: { deleteFails: true } });
      await expect(t.handler(eventFor(t.sub, t.key))).resolves.toMatchObject({ items: [expect.objectContaining({ name: 'Toor Dal' })] });
    });

    it('an empty result is a normal, successful answer, not an error', async () => {
      const t = setup({ invoke: () => Promise.resolve([]) });
      const result = await t.handler(eventFor(t.sub, t.key));
      expect(result).toEqual({ items: [], droppedCount: 0, truncated: false });
      expect(t.metrics).toEqual([expect.objectContaining({ itemsProposed: 0 })]);
    });
  });

  describe('the daily limit (SD §8.5: 20/day)', () => {
    it('refuses the 21st analysis BEFORE reading the photo or calling the model, and still cleans up', async () => {
      const t = setup();
      for (let i = 0; i < MAX_PHOTO_ANALYSES_PER_DAY; i++) {
        await t.handler(eventFor(t.sub, t.key));
      }
      t.calls.length = 0;
      t.invoke.mockClear();

      await expect(t.handler(eventFor(t.sub, t.key))).rejects.toBeInstanceOf(RateLimitedError);
      await expect(t.handler(eventFor(t.sub, t.key))).rejects.toThrow(/photo analyses/i);
      expect(t.invoke).not.toHaveBeenCalled();
      expect(t.calls.some((c) => c.startsWith('get:'))).toBe(false);
      expect(t.calls).toContain(`delete:${t.key}`);
    }, 60_000);

    it("one user's limit never affects another's", async () => {
      const a = setup();
      const b = setup();
      for (let i = 0; i < MAX_PHOTO_ANALYSES_PER_DAY; i++) await a.handler(eventFor(a.sub, a.key));
      await expect(b.handler(eventFor(b.sub, b.key))).resolves.toBeDefined();
    }, 60_000);
  });
});
