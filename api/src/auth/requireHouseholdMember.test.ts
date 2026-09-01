import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import {
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
} from '../repositories/householdRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import {
  evictMembershipCache,
  requireHouseholdMember,
  resetMembershipCacheForTesting,
} from './requireHouseholdMember.js';
import { ForbiddenError } from '../errors.js';

/**
 * Wraps a real `PoolClient` so a test can count how many queries actually
 * reached the database — proving the cache genuinely skipped one, rather
 * than merely asserting on the return value (which a bug in the cache could
 * still get right by accident, e.g. returning a hardcoded role).
 */
const countingClient = (client: PoolClient): { client: PoolClient; count: () => number } => {
  let count = 0;
  const countingQuery = (...args: unknown[]): unknown => {
    count += 1;
    return Reflect.apply(client.query, client, args);
  };
  // `PoolClient['query']` is a heavily overloaded signature (text-only,
  // text+values, a config object, each with/without a row-type generic and
  // a callback) that no single opaque forwarding function can satisfy
  // structurally — this cast suppresses that, not a real type hole: `args`
  // is forwarded verbatim to the real `client.query` via `Reflect.apply`
  // regardless of which overload the caller used, so the runtime behavior
  // is identical to calling `client.query` directly.
  const wrapped = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return countingQuery;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PoolClient;
  return { client: wrapped, count: () => count };
};

describe('requireHouseholdMember', () => {
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

  // Every test starts from an empty, production-TTL cache — a prior test's
  // entries (or a fake clock left behind by a TTL test) must never leak into
  // the next one, since the cache is a shared module-scope singleton.
  beforeEach(() => {
    resetMembershipCacheForTesting();
  });

  const createUser = async (): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, {
        cognitoSub: `sub-${randomUUID()}`,
        email: `${randomUUID()}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
  };

  const createHousehold = async (owner: UserRow): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, {
          name: `House of ${owner.id}`,
          inviteCode: `H${randomUUID().slice(0, 5).toUpperCase()}`,
          primaryUserId: owner.id,
        });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        return household.id;
      },
      pool,
    );

  it("returns the caller's role when they are a member", async () => {
    const owner = await createUser();
    const householdId = await createHousehold(owner);

    const role = await withUserTransaction(
      owner.id,
      (client) => requireHouseholdMember(client, owner.id, householdId),
      pool,
    );
    expect(role).toBe('primary');
  });

  it('throws ForbiddenError when the caller is not a member of a real household', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const householdId = await createHousehold(owner);

    await expect(
      withUserTransaction(
        stranger.id,
        (client) => requireHouseholdMember(client, stranger.id, householdId),
        pool,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws the identical ForbiddenError for a syntactically-valid but nonexistent household UUID', async () => {
    const stranger = await createUser();
    const owner = await createUser();
    const householdId = await createHousehold(owner);

    let nonMemberError: Error | undefined;
    try {
      await withUserTransaction(
        stranger.id,
        (client) => requireHouseholdMember(client, stranger.id, householdId),
        pool,
      );
    } catch (error) {
      nonMemberError = error as Error;
    }

    let nonexistentError: Error | undefined;
    try {
      await withUserTransaction(
        stranger.id,
        (client) => requireHouseholdMember(client, stranger.id, randomUUID()),
        pool,
      );
    } catch (error) {
      nonexistentError = error as Error;
    }

    expect(nonMemberError).toBeInstanceOf(ForbiddenError);
    expect(nonexistentError).toBeInstanceOf(ForbiddenError);
    // The whole point: identical message, so this can never be used as a
    // household-existence oracle by comparing error text between the two cases.
    expect(nonMemberError?.message).toBe(nonexistentError?.message);
  });

  describe('membership cache (W8 S5, E2E_MVP_PLAN.md §14.2.8 D2)', () => {
    it('a second call inside the TTL does not hit the database', async () => {
      const owner = await createUser();
      const householdId = await createHousehold(owner);

      await withUserTransaction(
        owner.id,
        async (client) => {
          const counting = countingClient(client);
          await requireHouseholdMember(counting.client, owner.id, householdId);
          const countAfterFirst = counting.count();
          expect(countAfterFirst).toBeGreaterThan(0);

          const role = await requireHouseholdMember(counting.client, owner.id, householdId);

          expect(role).toBe('primary');
          expect(counting.count()).toBe(countAfterFirst);
        },
        pool,
      );
    });

    it('a call after the TTL has elapsed hits the database again', async () => {
      const owner = await createUser();
      const householdId = await createHousehold(owner);
      let now = 0;
      resetMembershipCacheForTesting({ ttlMs: 1000, now: () => now });

      await withUserTransaction(
        owner.id,
        async (client) => {
          const counting = countingClient(client);
          await requireHouseholdMember(counting.client, owner.id, householdId);
          const countAfterFirst = counting.count();

          now += 1001; // past the 1000ms TTL
          await requireHouseholdMember(counting.client, owner.id, householdId);

          expect(counting.count()).toBeGreaterThan(countAfterFirst);
        },
        pool,
      );
    });

    it('a denial is never cached — a stranger who then joins is authorized on the very next call', async () => {
      const owner = await createUser();
      const stranger = await createUser();
      const householdId = await createHousehold(owner);

      await withUserTransaction(
        stranger.id,
        async (client) => {
          await expect(requireHouseholdMember(client, stranger.id, householdId)).rejects.toThrow(ForbiddenError);

          // The stranger becomes a member — nothing about this test relies on
          // going through joinHousehold's own resolver; inserting the row
          // directly is enough to prove the *denial itself* was never cached.
          await insertMembership(client, { householdId, userId: stranger.id, role: 'member' });

          const role = await requireHouseholdMember(client, stranger.id, householdId);
          expect(role).toBe('member');
        },
        pool,
      );
    });

    it('the cache is keyed on both userId and householdId — membership in one household never authorizes another', async () => {
      const ownerA = await createUser();
      const ownerB = await createUser();
      const householdA = await createHousehold(ownerA);
      const householdB = await createHousehold(ownerB);

      // ownerA is cached as a member of householdA...
      await withUserTransaction(
        ownerA.id,
        (client) => requireHouseholdMember(client, ownerA.id, householdA),
        pool,
      );

      // ...but has no membership in householdB at all, and must still be denied.
      await expect(
        withUserTransaction(
          ownerA.id,
          (client) => requireHouseholdMember(client, ownerA.id, householdB),
          pool,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('bypassCache: true always reads live, even with a warm cache entry for the same pair', async () => {
      const owner = await createUser();
      const householdId = await createHousehold(owner);

      await withUserTransaction(
        owner.id,
        async (client) => {
          // Warm the cache.
          await requireHouseholdMember(client, owner.id, householdId);

          const counting = countingClient(client);
          const countBefore = counting.count();
          await requireHouseholdMember(counting.client, owner.id, householdId, { bypassCache: true });

          expect(counting.count()).toBeGreaterThan(countBefore);
        },
        pool,
      );
    });

    it('evictMembershipCache() clears a warm entry — the next call reads live again', async () => {
      const owner = await createUser();
      const householdId = await createHousehold(owner);

      await withUserTransaction(
        owner.id,
        async (client) => {
          await requireHouseholdMember(client, owner.id, householdId);

          evictMembershipCache(owner.id, householdId);

          const counting = countingClient(client);
          await requireHouseholdMember(counting.client, owner.id, householdId);
          expect(counting.count()).toBeGreaterThan(0);
        },
        pool,
      );
    });

    it('entries for different users in the same household do not leak into each other', async () => {
      const owner = await createUser();
      const member = await createUser();
      const householdId = await createHousehold(owner);
      await withUserTransaction(
        owner.id,
        (client) => insertMembership(client, { householdId, userId: member.id, role: 'member' }),
        pool,
      );

      await withUserTransaction(
        owner.id,
        (client) => requireHouseholdMember(client, owner.id, householdId),
        pool,
      );

      // A cached entry for `owner` must never answer for `member`'s own,
      // separate cache key — proven here by a real membership lookup (not a
      // shared-key bug that would silently return the owner's role instead).
      const memberRole = await withUserTransaction(
        member.id,
        (client) => requireHouseholdMember(client, member.id, householdId),
        pool,
      );
      expect(memberRole).toBe('member');
    });
  });
});
