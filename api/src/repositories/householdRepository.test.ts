import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from './userRepository.js';
import {
  findHouseholdById,
  findHouseholdByInviteCode,
  findMembersForHousehold,
  findMembership,
  findMembershipsForUser,
  findSettingsForHousehold,
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
  insertMembershipWithinCap,
  updateSettingsPartial,
} from './householdRepository.js';
import type { MembershipRow } from './householdRepository.js';
import type { UserRow } from './userRepository.js';
import type { CallerIdentity } from '../auth/identity.js';

describe('householdRepository', () => {
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

  /** Every repository function takes a PoolClient, so every call here goes through a user-scoped transaction — this repository never opens its own. */
  const asUser = <T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> =>
    withUserTransaction(userId, fn, pool);

  const identity = (overrides: Partial<CallerIdentity> = {}): CallerIdentity => ({
    cognitoSub: `sub-${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    displayName: null,
    avatarUrl: null,
    ...overrides,
  });

  const createUser = async (): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, identity());
    } finally {
      client.release();
    }
  };

  const createFullHousehold = async (owner: UserRow, inviteCode: string): Promise<string> =>
    asUser(owner.id, async (client) => {
      const household = await insertHousehold(client, {
        name: `House of ${owner.id}`,
        inviteCode,
        primaryUserId: owner.id,
      });
      await insertMembership(client, {
        householdId: household.id,
        userId: owner.id,
        role: 'primary',
      });
      await insertDefaultSettings(client, household.id);
      return household.id;
    });

  it('insertHousehold, insertMembership, insertDefaultSettings all round-trip inside a user-scoped transaction', async () => {
    const owner = await createUser();

    const household = await asUser(owner.id, async (client) => {
      const inserted = await insertHousehold(client, {
        name: 'The Test House',
        inviteCode: 'ABC234',
        primaryUserId: owner.id,
      });
      await insertMembership(client, {
        householdId: inserted.id,
        userId: owner.id,
        role: 'primary',
      });
      await insertDefaultSettings(client, inserted.id);
      return inserted;
    });

    expect(household).toMatchObject({
      name: 'The Test House',
      inviteCode: 'ABC234',
      primaryUserId: owner.id,
      subscriptionStatus: 'free',
    });

    const found = await asUser(owner.id, (client) => findHouseholdById(client, household.id));
    expect(found).toMatchObject({ id: household.id, name: 'The Test House' });
  });

  it('rejects a household_settings insert when the membership insert was skipped (RLS ordering regression)', async () => {
    const owner = await createUser();

    await expect(
      asUser(owner.id, async (client) => {
        const household = await insertHousehold(client, {
          name: 'Orphan Settings House',
          inviteCode: 'DEF234',
          primaryUserId: owner.id,
        });
        // Deliberately skip insertMembership.
        await insertDefaultSettings(client, household.id);
      }),
    ).rejects.toThrow();
  });

  it('findMembershipsForUser returns [] for a user with no memberships', async () => {
    const owner = await createUser();
    const result = await asUser(owner.id, (client) => findMembershipsForUser(client, owner.id));
    expect(result).toEqual([]);
  });

  it("findMembershipsForUser returns only the caller's own memberships (cross-tenant read test)", async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();

    await createFullHousehold(ownerA, 'AAA234');
    await createFullHousehold(ownerB, 'BBB234');

    const membershipsA = await asUser(ownerA.id, (client) =>
      findMembershipsForUser(client, ownerA.id),
    );
    expect(membershipsA).toHaveLength(1);
    expect(membershipsA[0]).toMatchObject({ userId: ownerA.id });

    const membershipsB = await asUser(ownerB.id, (client) =>
      findMembershipsForUser(client, ownerB.id),
    );
    expect(membershipsB).toHaveLength(1);
    expect(membershipsB[0]).toMatchObject({ userId: ownerB.id });
  });

  it('findHouseholdById returns null when the household does not exist', async () => {
    const owner = await createUser();
    const result = await asUser(owner.id, (client) => findHouseholdById(client, randomUUID()));
    expect(result).toBeNull();
  });

  describe('findHouseholdByInviteCode', () => {
    it('returns the matching household', async () => {
      const owner = await createUser();
      const householdId = await createFullHousehold(owner, 'INV234');
      const found = await asUser(owner.id, (client) =>
        findHouseholdByInviteCode(client, 'INV234'),
      );
      expect(found).toMatchObject({ id: householdId, inviteCode: 'INV234' });
    });

    it('returns null for an unknown invite code', async () => {
      const owner = await createUser();
      const found = await asUser(owner.id, (client) =>
        findHouseholdByInviteCode(client, 'ZZZZZZ'),
      );
      expect(found).toBeNull();
    });

    it('accepts { forUpdate: true } without altering the result (row-lock variant)', async () => {
      const owner = await createUser();
      await createFullHousehold(owner, 'LCK234');
      const found = await asUser(owner.id, (client) =>
        findHouseholdByInviteCode(client, 'LCK234', { forUpdate: true }),
      );
      expect(found).toMatchObject({ inviteCode: 'LCK234' });
    });
  });

  describe('findMembership', () => {
    it('returns the membership row when the user is a member', async () => {
      const owner = await createUser();
      const householdId = await createFullHousehold(owner, 'MEM234');
      const found = await asUser(owner.id, (client) =>
        findMembership(client, householdId, owner.id),
      );
      expect(found).toMatchObject({ householdId, userId: owner.id, role: 'primary' });
    });

    it('returns null when the user is not a member', async () => {
      const owner = await createUser();
      const stranger = await createUser();
      const householdId = await createFullHousehold(owner, 'MEM235');
      const found = await asUser(stranger.id, (client) =>
        findMembership(client, householdId, stranger.id),
      );
      expect(found).toBeNull();
    });

    it('returns null (indistinguishable from non-member) for a nonexistent household', async () => {
      const owner = await createUser();
      const found = await asUser(owner.id, (client) =>
        findMembership(client, randomUUID(), owner.id),
      );
      expect(found).toBeNull();
    });
  });

  describe('insertMembershipWithinCap', () => {
    it('inserts and returns the row when under the cap', async () => {
      const owner = await createUser();
      const joiner = await createUser();
      const householdId = await createFullHousehold(owner, 'CAP234');

      const inserted = await asUser(joiner.id, (client) =>
        insertMembershipWithinCap(client, { householdId, userId: joiner.id, role: 'member' }, 5),
      );
      expect(inserted).toMatchObject({ householdId, userId: joiner.id, role: 'member' });
    });

    it('returns null (no insert) when the cap has already been reached', async () => {
      const owner = await createUser();
      const householdId = await createFullHousehold(owner, 'CAP235');

      // Fill up to a cap of 1 (owner already counts as 1 member).
      const other = await createUser();
      const result = await asUser(other.id, (client) =>
        insertMembershipWithinCap(client, { householdId, userId: other.id, role: 'member' }, 1),
      );
      expect(result).toBeNull();

      const count = await pool.query('SELECT count(*)::int AS n FROM household_memberships WHERE household_id = $1', [
        householdId,
      ]);
      expect(count.rows[0].n).toBe(1);
    });

    it('5-member cap under real concurrency: exactly one of two simultaneous joins for the 5th slot succeeds', async () => {
      const owner = await createUser();
      const householdId = await createFullHousehold(owner, 'CAP236');

      // Fill to 4 members total (owner + 3 more).
      const existingMembers = await Promise.all([createUser(), createUser(), createUser()]);
      for (const member of existingMembers) {
        await asUser(member.id, (client) =>
          insertMembershipWithinCap(client, { householdId, userId: member.id, role: 'member' }, 5),
        );
      }
      const preCount = await pool.query(
        'SELECT count(*)::int AS n FROM household_memberships WHERE household_id = $1',
        [householdId],
      );
      expect(preCount.rows[0].n).toBe(4);

      // Two distinct users race for the 5th slot, each inside its own real
      // transaction, started concurrently via Promise.all (not sequential
      // awaits) — this genuinely exercises Postgres's row-lock serialization,
      // not merely application-level sequencing.
      const contenderA = await createUser();
      const contenderB = await createUser();

      const attemptJoin = (userId: string): Promise<MembershipRow | null> =>
        withUserTransaction(
          userId,
          async (client) => {
            // Mirrors joinHousehold's real flow: lock the household row first.
            await client.query('SELECT * FROM households WHERE id = $1 FOR UPDATE', [householdId]);
            return insertMembershipWithinCap(client, { householdId, userId, role: 'member' }, 5);
          },
          pool,
        );

      const [resultA, resultB] = await Promise.all([
        attemptJoin(contenderA.id),
        attemptJoin(contenderB.id),
      ]);

      const results = [resultA, resultB];
      const succeeded = results.filter((r) => r !== null);
      const rejected = results.filter((r) => r === null);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const finalCount = await pool.query(
        'SELECT count(*)::int AS n FROM household_memberships WHERE household_id = $1',
        [householdId],
      );
      expect(finalCount.rows[0].n).toBe(5);
    });
  });

  describe('findSettingsForHousehold', () => {
    it('returns the settings row for an existing household', async () => {
      const owner = await createUser();
      const householdId = await createFullHousehold(owner, 'SET234');
      const found = await asUser(owner.id, (client) => findSettingsForHousehold(client, householdId));
      expect(found).toMatchObject({ householdId });
    });

    it('returns null for a nonexistent household', async () => {
      const owner = await createUser();
      const found = await asUser(owner.id, (client) =>
        findSettingsForHousehold(client, randomUUID()),
      );
      expect(found).toBeNull();
    });
  });

  describe('updateSettingsPartial', () => {
    it('updates only the provided fields, leaving the rest unchanged (COALESCE semantics)', async () => {
      const owner = await createUser();
      const householdId = await createFullHousehold(owner, 'UPD234');

      const updated = await asUser(owner.id, (client) =>
        updateSettingsPartial(client, householdId, { allergens: ['peanuts'] }),
      );

      expect(updated?.allergens).toEqual(['peanuts']);
      // Untouched fields keep their defaults.
      expect(updated?.mealsEnabled).toEqual(['breakfast', 'lunch', 'dinner']);
      expect(updated?.cuisineTier1).toEqual(['north_indian']);
    });

    it('returns null when the household has no settings row', async () => {
      const owner = await createUser();
      const result = await asUser(owner.id, (client) =>
        updateSettingsPartial(client, randomUUID(), { allergens: ['peanuts'] }),
      );
      expect(result).toBeNull();
    });

    it("RLS-only regression: updating another household's settings, bypassing any resolver-level membership gate, affects zero rows", async () => {
      const ownerA = await createUser();
      const ownerB = await createUser();
      const householdBId = await createFullHousehold(ownerB, 'RLS234');

      // ownerA is never a member of household B. Calling the repository
      // function directly (no requireHouseholdMember in front of it) proves
      // RLS itself — not just the resolver's own check — blocks the write.
      const result = await asUser(ownerA.id, (client) =>
        updateSettingsPartial(client, householdBId, { allergens: ['shellfish'] }),
      );
      expect(result).toBeNull();

      const stillDefault = await asUser(ownerB.id, (client) =>
        findSettingsForHousehold(client, householdBId),
      );
      expect(stillDefault?.allergens).toEqual([]);
    });
  });

  describe('findMembersForHousehold', () => {
    it("returns every member joined to that member's own user row", async () => {
      const owner = await createUser();
      const householdId = await createFullHousehold(owner, 'MBR234');
      const joiner = await createUser();
      await asUser(joiner.id, (client) =>
        insertMembershipWithinCap(client, { householdId, userId: joiner.id, role: 'member' }, 5),
      );

      const members = await asUser(owner.id, (client) => findMembersForHousehold(client, householdId));
      expect(members).toHaveLength(2);
      const userIds = members.map((m) => m.user.id).sort();
      expect(userIds).toEqual([owner.id, joiner.id].sort());
      expect(members.find((m) => m.userId === owner.id)?.role).toBe('primary');
      expect(members.find((m) => m.userId === joiner.id)?.role).toBe('member');
    });

    it('returns [] for a household with no members', async () => {
      const owner = await createUser();
      const members = await asUser(owner.id, (client) =>
        findMembersForHousehold(client, randomUUID()),
      );
      expect(members).toEqual([]);
    });
  });
});
