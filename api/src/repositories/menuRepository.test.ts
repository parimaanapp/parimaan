import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from './userRepository.js';
import { insertHousehold, insertMembership } from './householdRepository.js';
import { createMenu, findMenuByWeek, findMenuItems } from './menuRepository.js';
import type { UserRow } from './userRepository.js';

describe('menuRepository', () => {
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

  const insertRecipe = async (
    client: PoolClient,
    householdId: string,
    createdBy: string,
    overrides: { title?: string; role?: string } = {},
  ): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO recipes (household_id, source_type, title, role, is_favorite, created_by)
       VALUES ($1, 'user', $2, $3, false, $4) RETURNING id`,
      [householdId, overrides.title ?? 'Rajma', overrides.role ?? 'sabzi_dal', createdBy],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Expected an inserted recipe row.');
    }
    return row;
  };

  const insertMenuItem = async (
    client: PoolClient,
    menuId: string,
    recipeId: string,
    overrides: { dayOfWeek?: number; mealSlot?: string; slotRole?: string } = {},
  ): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        menuId,
        recipeId,
        overrides.dayOfWeek ?? 0,
        overrides.mealSlot ?? 'dinner',
        overrides.slotRole ?? 'sabzi_dal',
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Expected an inserted menu_item row.');
    }
    return row;
  };

  describe('createMenu', () => {
    it('creates a menu with the given household and week', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const menu = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));
      expect(menu.householdId).toBe(householdId);
      expect(menu.weekStartDate).toBe('2026-09-07');
    });

    it('is idempotent for the same household + week: repeat calls return the same row, no duplicate created', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const first = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));
      const second = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));
      expect(second.id).toBe(first.id);

      const count = await asUser(owner.id, async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM menus WHERE household_id = $1`,
          [householdId],
        );
        return Number(result.rows[0]?.count);
      });
      expect(count).toBe(1);
    });

    it('creates a distinct menu for a different week in the same household', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const first = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));
      const second = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-14'));
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('findMenuByWeek', () => {
    it('returns null when no menu exists yet for that week — never implicitly creates one', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const menu = await asUser(owner.id, (client) => findMenuByWeek(client, householdId, '2026-09-07'));
      expect(menu).toBeNull();

      const count = await asUser(owner.id, async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM menus WHERE household_id = $1`,
          [householdId],
        );
        return Number(result.rows[0]?.count);
      });
      expect(count).toBe(0);
    });

    it('finds an existing menu for the exact week', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const created = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));

      const found = await asUser(owner.id, (client) => findMenuByWeek(client, householdId, '2026-09-07'));
      expect(found?.id).toBe(created.id);
    });
  });

  describe('findMenuItems', () => {
    it('returns [] for a menu with no items', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const menu = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));

      const items = await asUser(owner.id, (client) => findMenuItems(client, menu.id));
      expect(items).toEqual([]);
    });

    it('hydrates multiple items with their full recipes, ordered by day/slot', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const menu = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));

      await asUser(owner.id, async (client) => {
        const poha = await insertRecipe(client, householdId, owner.id, { title: 'Poha', role: 'breakfast' });
        const rajma = await insertRecipe(client, householdId, owner.id, { title: 'Rajma' });
        await insertMenuItem(client, menu.id, rajma.id, { dayOfWeek: 1, mealSlot: 'dinner' });
        await insertMenuItem(client, menu.id, poha.id, { dayOfWeek: 0, mealSlot: 'breakfast' });
      });

      const items = await asUser(owner.id, (client) => findMenuItems(client, menu.id));
      expect(items.map((item) => item.recipe.title)).toEqual(['Poha', 'Rajma']);
      expect(items.every((item) => item.recipe.id !== undefined)).toBe(true);
    });

    it("drops a menu item whose recipe id doesn't come back from the batch fetch (RLS-excluded), rather than throwing", async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const menu = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));

      const otherOwner = await createUser();
      const otherHouseholdId = await createHouseholdWithMember(otherOwner);
      const foreignRecipe = await asUser(otherOwner.id, (client) =>
        insertRecipe(client, otherHouseholdId, otherOwner.id),
      );

      // Wired up via the admin client, bypassing the app-level ownership
      // check a future addMenuItem mutation will need (E2E_MVP_PLAN.md
      // §15.2's security-review note) — this exists purely to construct the
      // otherwise-unreachable state findMenuItems must defend against: a
      // menu_items row whose recipe_id exists (satisfying the FK) but is
      // invisible to the caller's own RLS-scoped findRecipesByIds call.
      await db.adminClient.query(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role)
         VALUES ($1, $2, 0, 'dinner', 'sabzi_dal')`,
        [menu.id, foreignRecipe.id],
      );

      const items = await asUser(owner.id, (client) => findMenuItems(client, menu.id));
      expect(items).toEqual([]);
    });
  });
});
