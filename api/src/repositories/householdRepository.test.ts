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
  findMembershipsForUser,
  insertDefaultSettings,
  insertHousehold,
  insertMembership,
} from './householdRepository.js';
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
});
