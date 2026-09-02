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
  createMenu,
  deleteUnmadeMenuItems,
  findInRotationRecipesForAutoFill,
  findMenuByWeek,
  findMenuItems,
  findRecentRecipeUsage,
  lockMenu,
} from './menuRepository.js';
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
    overrides: {
      title?: string;
      role?: string;
      inRotation?: boolean;
      cuisineTier1?: string;
      cuisineTier2?: string;
    } = {},
  ): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO recipes (household_id, source_type, title, role, is_favorite, in_rotation, cuisine_tier1, cuisine_tier2, created_by)
       VALUES ($1, 'user', $2, $3, false, $4, $5, $6, $7) RETURNING id`,
      [
        householdId,
        overrides.title ?? 'Rajma',
        overrides.role ?? 'sabzi_dal',
        overrides.inRotation ?? true,
        overrides.cuisineTier1 ?? null,
        overrides.cuisineTier2 ?? null,
        createdBy,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Expected an inserted recipe row.');
    }
    return row;
  };

  const insertRecipeIngredient = async (client: PoolClient, recipeId: string, name: string): Promise<void> => {
    await client.query(`INSERT INTO recipe_ingredients (recipe_id, name, sort_order) VALUES ($1, $2, 0)`, [
      recipeId,
      name,
    ]);
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

  describe('lockMenu', () => {
    it('is a no-op that succeeds and releases automatically at transaction end (no explicit unlock needed)', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const menu = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));

      await expect(asUser(owner.id, (client) => lockMenu(client, menu.id))).resolves.toBeUndefined();
      // A second, separate transaction can immediately take the same lock —
      // proof the first one released at COMMIT rather than leaking.
      await expect(asUser(owner.id, (client) => lockMenu(client, menu.id))).resolves.toBeUndefined();
    });
  });

  describe('findInRotationRecipesForAutoFill', () => {
    it('returns only in-rotation recipes for the household, with role/cuisine columns', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const inRotation = await asUser(owner.id, (client) =>
        insertRecipe(client, householdId, owner.id, { title: 'In Rotation', role: 'carb', cuisineTier1: 'north_indian', cuisineTier2: 'punjabi' }),
      );
      await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id, { title: 'Out', inRotation: false }));

      const candidates = await asUser(owner.id, (client) => findInRotationRecipesForAutoFill(client, householdId, []));
      expect(candidates).toEqual([
        { id: inRotation.id, role: 'carb', cuisineTier1: 'north_indian', cuisineTier2: 'punjabi' },
      ]);
    });

    it('excludes a recipe containing a skip-listed ingredient (substring, case-insensitive)', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);

      const safe = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id, { title: 'Safe' }));
      await asUser(owner.id, async (client) => {
        const recipe = await insertRecipe(client, householdId, owner.id, { title: 'Has Peanuts' });
        await insertRecipeIngredient(client, recipe.id, 'Crushed PEANUTS');
      });

      const candidates = await asUser(owner.id, (client) =>
        findInRotationRecipesForAutoFill(client, householdId, ['peanut']),
      );
      expect(candidates.map((c) => c.id)).toEqual([safe.id]);
    });

    it('a skip term containing "_" (a LIKE single-character wildcard) is matched literally, not as a wildcard', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const withUnderscore = await asUser(owner.id, async (client) => {
        const recipe = await insertRecipe(client, householdId, owner.id, { title: 'Has literal underscore' });
        await insertRecipeIngredient(client, recipe.id, 'sun_dried tomato');
        return recipe;
      });
      // Contains "sunXdried" — the "_"-as-wildcard shape "sun_dried" would
      // ALSO match this if "_" were left unescaped (any single char in that
      // position), even though "salt" has no literal underscore at all.
      const noUnderscore = await asUser(owner.id, async (client) => {
        const recipe = await insertRecipe(client, householdId, owner.id, { title: 'No underscore' });
        await insertRecipeIngredient(client, recipe.id, 'sunXdried salt');
        return recipe;
      });

      const candidates = await asUser(owner.id, (client) =>
        findInRotationRecipesForAutoFill(client, householdId, ['sun_dried']),
      );

      // Correct (escaped) behavior: only the recipe with a LITERAL
      // underscore is excluded. If escaping were broken, "sunXdried" would
      // also match "sun_dried"'s wildcard shape and both would be excluded,
      // leaving `candidates` empty instead of containing `noUnderscore`.
      expect(candidates.map((c) => c.id)).toEqual([noUnderscore.id]);
      expect(candidates.map((c) => c.id)).not.toContain(withUnderscore.id);
    });

    it('an empty skipIngredients list excludes nothing', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      await asUser(owner.id, async (client) => {
        const recipe = await insertRecipe(client, householdId, owner.id);
        await insertRecipeIngredient(client, recipe.id, 'Peanuts');
      });

      const candidates = await asUser(owner.id, (client) => findInRotationRecipesForAutoFill(client, householdId, []));
      expect(candidates).toHaveLength(1);
    });
  });

  describe('findRecentRecipeUsage', () => {
    it('returns the fewest weeks since a recipe was last planned, within the window', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipe = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id));

      // Planned 2 weeks before the target (2026-09-21), and again 1 week before.
      await asUser(owner.id, async (client) => {
        const menuTwoWeeksAgo = await createMenu(client, householdId, '2026-09-07');
        await insertMenuItem(client, menuTwoWeeksAgo.id, recipe.id);
        const menuOneWeekAgo = await createMenu(client, householdId, '2026-09-14');
        await insertMenuItem(client, menuOneWeekAgo.id, recipe.id);
      });

      const usage = await asUser(owner.id, (client) =>
        findRecentRecipeUsage(client, householdId, '2026-09-21', 3),
      );
      expect(usage).toEqual([{ recipeId: recipe.id, weeksAgo: 1 }]);
    });

    it('excludes usage outside the window', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipe = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id));

      await asUser(owner.id, async (client) => {
        const menuFourWeeksAgo = await createMenu(client, householdId, '2026-08-24');
        await insertMenuItem(client, menuFourWeeksAgo.id, recipe.id);
      });

      const usage = await asUser(owner.id, (client) =>
        findRecentRecipeUsage(client, householdId, '2026-09-21', 3),
      );
      expect(usage).toEqual([]);
    });

    it('never counts the target week itself as recent usage', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const recipe = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id));

      await asUser(owner.id, async (client) => {
        const targetMenu = await createMenu(client, householdId, '2026-09-21');
        await insertMenuItem(client, targetMenu.id, recipe.id);
      });

      const usage = await asUser(owner.id, (client) =>
        findRecentRecipeUsage(client, householdId, '2026-09-21', 3),
      );
      expect(usage).toEqual([]);
    });
  });

  describe('deleteUnmadeMenuItems', () => {
    it('deletes every item without madeAt set, preserving items with madeAt set', async () => {
      const owner = await createUser();
      const householdId = await createHouseholdWithMember(owner);
      const menu = await asUser(owner.id, (client) => createMenu(client, householdId, '2026-09-07'));
      const recipe = await asUser(owner.id, (client) => insertRecipe(client, householdId, owner.id));

      const madeItem = await asUser(owner.id, (client) =>
        insertMenuItem(client, menu.id, recipe.id, { dayOfWeek: 0, mealSlot: 'lunch' }),
      );
      await asUser(owner.id, (client) => insertMenuItem(client, menu.id, recipe.id, { dayOfWeek: 1, mealSlot: 'lunch' }));
      await db.adminClient.query(`UPDATE menu_items SET made_at = NOW() WHERE id = $1`, [madeItem.id]);

      await asUser(owner.id, (client) => deleteUnmadeMenuItems(client, menu.id));

      const remaining = await asUser(owner.id, (client) => findMenuItems(client, menu.id));
      expect(remaining.map((item) => item.id)).toEqual([madeItem.id]);
    });
  });
});
