import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from './userRepository.js';
import { insertHousehold, insertMembership } from './householdRepository.js';
import { findPantryItems, insertPantryItem } from './pantryRepository.js';
import type { UserRow } from './userRepository.js';

describe('pantryRepository', () => {
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

  const asUser = <T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> =>
    withUserTransaction(userId, fn, pool);

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

  const createHouseholdWithMember = async (owner: UserRow): Promise<string> =>
    asUser(owner.id, async (client) => {
      const household = await insertHousehold(client, {
        name: `House ${randomUUID()}`,
        inviteCode: `INV${randomUUID().slice(0, 6)}`,
        primaryUserId: owner.id,
      });
      await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
      return household.id;
    });

  it('inserts a pantry item and returns it with generated fields populated', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    const item = await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Toor Dal',
        quantity: 2,
        unit: 'kg',
        category: 'dal',
        isStaple: true,
        expiryDate: null,
        lowThreshold: 0.5,
        addedBy: owner.id,
      }),
    );

    expect(item.id).toEqual(expect.any(String));
    expect(item.name).toBe('Toor Dal');
    expect(item.quantity).toBe(2);
    expect(item.unit).toBe('kg');
    expect(item.category).toBe('dal');
    expect(item.isStaple).toBe(true);
    expect(item.lowThreshold).toBe(0.5);
    expect(item.addedBy).toBe(owner.id);
    expect(item.addedAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  it('round-trips a numeric quantity as a JS number, not a string', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    const item = await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Rice',
        quantity: 1.5,
        unit: 'kg',
        category: null,
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );

    expect(typeof item.quantity).toBe('number');
    expect(item.quantity).toBe(1.5);
  });

  it('round-trips expiryDate as a YYYY-MM-DD string', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);

    const item = await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Milk',
        quantity: 1,
        unit: 'l',
        category: 'dairy',
        isStaple: false,
        expiryDate: '2027-03-01',
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );

    expect(item.expiryDate).toBe('2027-03-01');
  });

  it('finds only items belonging to the given household', async () => {
    const owner = await createUser();
    const householdA = await createHouseholdWithMember(owner);
    const householdB = await createHouseholdWithMember(owner);

    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId: householdA,
        name: 'Toor Dal',
        quantity: 1,
        unit: 'kg',
        category: null,
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId: householdB,
        name: 'Chana Dal',
        quantity: 1,
        unit: 'kg',
        category: null,
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );

    const items = await asUser(owner.id, (client) => findPantryItems(client, householdA));
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('Toor Dal');
  });

  it('filters by case-insensitive substring search against name', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Toor Dal',
        quantity: 1,
        unit: 'kg',
        category: null,
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Basmati Rice',
        quantity: 1,
        unit: 'kg',
        category: null,
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );

    const results = await asUser(owner.id, (client) =>
      findPantryItems(client, householdId, { search: 'DAL' }),
    );
    expect(results.map((item) => item.name)).toEqual(['Toor Dal']);
  });

  it('is injection-proof: a LIKE-pattern-breaking search string matches nothing, not everything', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Toor Dal',
        quantity: 1,
        unit: 'kg',
        category: null,
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );

    const results = await asUser(owner.id, (client) =>
      findPantryItems(client, householdId, { search: "%' OR '1'='1" }),
    );
    expect(results).toHaveLength(0);
  });

  it('filters by exact category match', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Toor Dal',
        quantity: 1,
        unit: 'kg',
        category: 'dal',
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Basmati Rice',
        quantity: 1,
        unit: 'kg',
        category: 'grain',
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );

    const results = await asUser(owner.id, (client) =>
      findPantryItems(client, householdId, { category: 'grain' }),
    );
    expect(results.map((item) => item.name)).toEqual(['Basmati Rice']);
  });

  it('combines search and category filters', async () => {
    const owner = await createUser();
    const householdId = await createHouseholdWithMember(owner);
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Toor Dal',
        quantity: 1,
        unit: 'kg',
        category: 'dal',
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );
    await asUser(owner.id, (client) =>
      insertPantryItem(client, {
        householdId,
        name: 'Chana Dal',
        quantity: 1,
        unit: 'kg',
        category: 'other',
        isStaple: false,
        expiryDate: null,
        lowThreshold: null,
        addedBy: owner.id,
      }),
    );

    const results = await asUser(owner.id, (client) =>
      findPantryItems(client, householdId, { search: 'dal', category: 'dal' }),
    );
    expect(results.map((item) => item.name)).toEqual(['Toor Dal']);
  });
});
