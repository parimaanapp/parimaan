import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from './userRepository.js';
import { insertHousehold, insertMembership } from './householdRepository.js';
import {
  deletePantryItemById,
  findPantryItemById,
  findPantryItems,
  insertPantryItem,
  updatePantryItemPartial,
} from './pantryRepository.js';
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

  describe('findPantryItemById', () => {
    it('finds an item belonging to the caller\'s own household', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await asUser(owner.id, (client) =>
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

      const found = await asUser(owner.id, (client) => findPantryItemById(client, item.id));
      expect(found?.id).toBe(item.id);
    });

    it('returns null for a nonexistent id', async () => {
      const owner = await createUser();
      await createHouseholdWithMember(owner);
      const found = await asUser(owner.id, (client) => findPantryItemById(client, randomUUID()));
      expect(found).toBeNull();
    });

    // RLS-only regression: this repository function is called directly here,
    // bypassing any resolver-level membership gate entirely — same
    // "repository test doubles as an RLS-only test" convention as
    // `householdRepository.test.ts`'s `updateSettingsPartial` coverage.
    it('returns null for an item belonging to a household the caller is not a member of (RLS)', async () => {
      const owner = await createUser();
      const outsider = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await asUser(owner.id, (client) =>
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

      const found = await asUser(outsider.id, (client) => findPantryItemById(client, item.id));
      expect(found).toBeNull();
    });
  });

  describe('updatePantryItemPartial', () => {
    const insertItem = (
      owner: UserRow,
      householdId: string,
    ): ReturnType<typeof insertPantryItem> =>
      asUser(owner.id, (client) =>
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

    it('updates only the provided fields, leaving the rest unchanged', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await insertItem(owner, householdId);

      const updated = await asUser(owner.id, (client) =>
        updatePantryItemPartial(client, item.id, { quantity: 5 }),
      );

      expect(updated?.quantity).toBe(5);
      expect(updated?.name).toBe('Toor Dal');
      expect(updated?.unit).toBe('kg');
      expect(updated?.category).toBe('dal');
    });

    it('moves updatedAt forward', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await insertItem(owner, householdId);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const updated = await asUser(owner.id, (client) =>
        updatePantryItemPartial(client, item.id, { quantity: 5 }),
      );

      expect(updated?.updatedAt.getTime()).toBeGreaterThan(item.updatedAt.getTime());
    });

    it('returns null for a nonexistent id', async () => {
      const owner = await createUser();
      await createHouseholdWithMember(owner);
      const updated = await asUser(owner.id, (client) =>
        updatePantryItemPartial(client, randomUUID(), { quantity: 5 }),
      );
      expect(updated).toBeNull();
    });

    it('returns null (updates nothing) for an item in another household — RLS', async () => {
      const owner = await createUser();
      const outsider = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await insertItem(owner, householdId);

      const updated = await asUser(outsider.id, (client) =>
        updatePantryItemPartial(client, item.id, { quantity: 999 }),
      );
      expect(updated).toBeNull();

      const stillOriginal = await asUser(owner.id, (client) => findPantryItemById(client, item.id));
      expect(stillOriginal?.quantity).toBe(1);
    });
  });

  describe('deletePantryItemById', () => {
    it('deletes the item and returns the deleted row', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await asUser(owner.id, (client) =>
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

      const deleted = await asUser(owner.id, (client) => deletePantryItemById(client, item.id));
      expect(deleted?.id).toBe(item.id);

      const stillThere = await asUser(owner.id, (client) => findPantryItemById(client, item.id));
      expect(stillThere).toBeNull();
    });

    it('a second delete of the same id returns null, not an error', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await asUser(owner.id, (client) =>
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

      await asUser(owner.id, (client) => deletePantryItemById(client, item.id));
      const secondDelete = await asUser(owner.id, (client) => deletePantryItemById(client, item.id));
      expect(secondDelete).toBeNull();
    });

    it('returns null (deletes nothing) for an item in another household — RLS', async () => {
      const owner = await createUser();
      const outsider = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const item = await asUser(owner.id, (client) =>
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

      const deleted = await asUser(outsider.id, (client) => deletePantryItemById(client, item.id));
      expect(deleted).toBeNull();

      const stillThere = await asUser(owner.id, (client) => findPantryItemById(client, item.id));
      expect(stillThere?.id).toBe(item.id);
    });
  });
});
