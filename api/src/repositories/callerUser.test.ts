import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool as PgPool, PoolClient } from 'pg';
import { Pool } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { resetCallerUserCacheForTesting, resolveCallerUser } from './callerUser.js';
import type { CallerIdentity } from '../auth/identity.js';

/**
 * Wraps a `Pool` so every `PoolClient.query()` issued by a client the pool
 * hands out via `.connect()` is counted — proving a cache hit genuinely
 * skips the database round trip, not just that it returns the right value.
 * Mirrors `requireHouseholdMember.test.ts`'s `countingClient()` (W8 S5), one
 * level up: `resolveCallerUser` takes a `Pool`, not a caller-supplied
 * `PoolClient`, so the counting has to be installed at `connect()` time.
 * `Reflect.apply` forwards `args`/`queryArgs` verbatim, so no cast is needed
 * for the same reason `countingClient()` doesn't need one.
 */
const countingPool = (pool: PgPool): { pool: PgPool; count: () => number } => {
  let count = 0;
  const wrapped = new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'connect') {
        return async (...args: unknown[]): Promise<unknown> => {
          const client: PoolClient = await Reflect.apply(target.connect, target, args);
          return new Proxy(client, {
            get(clientTarget, clientProp, clientReceiver) {
              if (clientProp === 'query') {
                return (...queryArgs: unknown[]): unknown => {
                  count += 1;
                  return Reflect.apply(clientTarget.query, clientTarget, queryArgs);
                };
              }
              return Reflect.get(clientTarget, clientProp, clientReceiver);
            },
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PgPool;
  return { pool: wrapped, count: () => count };
};

describe('resolveCallerUser', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  beforeEach(() => {
    resetCallerUserCacheForTesting();
  });

  const identity = (overrides: Partial<CallerIdentity> = {}): CallerIdentity => ({
    cognitoSub: `sub-${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    displayName: null,
    avatarUrl: null,
    ...overrides,
  });

  it('creates a users row on first call and releases the client back to the pool', async () => {
    const idleBefore = pool.idleCount;
    const user = await resolveCallerUser(pool, identity());
    expect(user.id).toBeDefined();
    expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
  });

  it('returns the same user on a second call with the same cognitoSub, not a duplicate', async () => {
    const id = identity();
    const first = await resolveCallerUser(pool, id);
    const second = await resolveCallerUser(pool, id);
    expect(second.id).toBe(first.id);
  });

  it('releases the client even if the upsert fails', async () => {
    const idleBefore = pool.idleCount;
    const conflicting = identity();
    await resolveCallerUser(pool, conflicting);
    // Same email, different sub -> ConflictError from upsertUserByCognitoSub.
    await expect(resolveCallerUser(pool, identity({ email: conflicting.email }))).rejects.toThrow();
    expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
  });

  describe('caching (W8 S6)', () => {
    it('a second call within the TTL does not touch the database', async () => {
      const counting = countingPool(pool);
      const id = identity();

      await resolveCallerUser(counting.pool, id);
      const countAfterFirst = counting.count();
      expect(countAfterFirst).toBeGreaterThan(0);

      const cached = await resolveCallerUser(counting.pool, id);

      expect(cached.cognitoSub).toBe(id.cognitoSub);
      expect(counting.count()).toBe(countAfterFirst);
    });

    it('a call after the TTL has elapsed upserts again', async () => {
      let now = 0;
      resetCallerUserCacheForTesting({ ttlMs: 1_000, now: () => now });
      const counting = countingPool(pool);
      const id = identity();

      await resolveCallerUser(counting.pool, id);
      const countAfterFirst = counting.count();

      now += 1_001;
      await resolveCallerUser(counting.pool, id);

      expect(counting.count()).toBeGreaterThan(countAfterFirst);
    });

    it('a failed upsert is never cached — a retry for the same cognitoSub still hits the database', async () => {
      const counting = countingPool(pool);
      const owner = identity();
      await resolveCallerUser(counting.pool, owner);

      const conflicting = identity({ email: owner.email, cognitoSub: `sub-${randomUUID()}` });
      await expect(resolveCallerUser(counting.pool, conflicting)).rejects.toThrow();
      const countAfterFailure = counting.count();

      const retried = { ...conflicting, email: `${randomUUID()}@example.test` };
      const user = await resolveCallerUser(counting.pool, retried);

      expect(user.cognitoSub).toBe(conflicting.cognitoSub);
      expect(counting.count()).toBeGreaterThan(countAfterFailure);
    });

    it('two different cognitoSubs never see each other\'s cached row', async () => {
      const alice = identity();
      const bob = identity();

      const aliceUser = await resolveCallerUser(pool, alice);
      const bobUser = await resolveCallerUser(pool, bob);

      expect(aliceUser.id).not.toBe(bobUser.id);

      const aliceAgain = await resolveCallerUser(pool, alice);
      const bobAgain = await resolveCallerUser(pool, bob);

      expect(aliceAgain.id).toBe(aliceUser.id);
      expect(bobAgain.id).toBe(bobUser.id);
    });

    it('a changed display name propagates once the TTL has elapsed', async () => {
      let now = 0;
      resetCallerUserCacheForTesting({ ttlMs: 1_000, now: () => now });
      const id = identity({ displayName: 'Original Name' });

      const first = await resolveCallerUser(pool, id);
      expect(first.displayName).toBe('Original Name');

      now += 1_001;
      const second = await resolveCallerUser(pool, { ...id, displayName: 'New Name' });

      expect(second.displayName).toBe('New Name');
    });
  });
});
