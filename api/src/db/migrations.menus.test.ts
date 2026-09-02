import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';
import {
  APP_ROLE,
  APP_ROLE_PASSWORD_ENV_VAR,
  APP_ROLE_TEST_PASSWORD,
  POSTGRES_IMAGE,
  firstRow,
  getColumnTypes,
  insertHousehold,
  insertUser,
  tableExists,
} from './migrationTestHelpers.js';

/**
 * W9 S1 (E2E_MVP_PLAN.md §15.3). Same Testcontainers-per-describe-block
 * pattern as `migrations.recipes.test.ts`/`migrations.notificationPreferences.test.ts`.
 * `menu_items` is the third table in this schema with no `household_id` of
 * its own (after `recipe_ingredients` and `notification_preferences`'s
 * per-user variant) — its highest-value tests are the direct-query-denial
 * ones, proving RLS via the `menus` parent join actually holds without the
 * caller ever touching `menus` first.
 */
describe('menus and menu_items, once migrated', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  const rlsProbeRole = 'menus_rls_probe_role';
  const rlsProbePassword = 'menus_rls_probe_password';

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await client.query(`CREATE ROLE ${rlsProbeRole} LOGIN PASSWORD '${rlsProbePassword}'`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON menus, menu_items, recipes, household_memberships TO ${rlsProbeRole}`,
    );
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  beforeEach(async () => {
    await client.query(
      'TRUNCATE TABLE menu_items, menus, recipes, household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
    );
  });

  const connectAsRlsProbe = async (userId: string): Promise<Client> => {
    const uri = new URL(container.getConnectionUri());
    uri.username = rlsProbeRole;
    uri.password = rlsProbePassword;
    const probeClient = new Client({ connectionString: uri.toString() });
    await probeClient.connect();
    await probeClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [userId]);
    return probeClient;
  };

  const addMember = async (householdId: string, userId: string): Promise<void> => {
    await client.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdId, userId],
    );
  };

  const insertRecipe = async (householdId: string, createdBy: string): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO recipes (household_id, source_type, title, role, created_by)
       VALUES ($1, 'user', $2, 'sabzi_dal', $3) RETURNING id`,
      [householdId, 'Rajma', createdBy],
    );
    return firstRow(result.rows);
  };

  const insertMenu = async (householdId: string, weekStartDate = '2026-09-07'): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO menus (household_id, week_start_date) VALUES ($1, $2) RETURNING id`,
      [householdId, weekStartDate],
    );
    return firstRow(result.rows);
  };

  const insertMenuItem = async (menuId: string, recipeId: string): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role)
       VALUES ($1, $2, 1, 'lunch', 'sabzi_dal') RETURNING id`,
      [menuId, recipeId],
    );
    return firstRow(result.rows);
  };

  it('creates the menus table with the expected columns and types', async () => {
    const columns = await getColumnTypes(client, 'menus');
    expect(columns).toMatchObject({
      id: 'uuid',
      household_id: 'uuid',
      week_start_date: 'date',
    });
  });

  it('creates the menu_items table with the expected columns and types, and no household_id', async () => {
    const columns = await getColumnTypes(client, 'menu_items');
    expect(columns).toMatchObject({
      id: 'uuid',
      menu_id: 'uuid',
      recipe_id: 'uuid',
      day_of_week: 'integer',
      meal_slot: 'text',
      slot_role: 'text',
      servings_override: 'integer',
      made_at: 'timestamp with time zone',
      created_at: 'timestamp with time zone',
    });
    expect(columns.household_id).toBeUndefined();
  });

  it('rejects a day_of_week outside 0-6', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    const menu = await insertMenu(household.id);

    await expect(
      client.query(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 7, 'lunch', 'sabzi_dal')`,
        [menu.id, recipe.id],
      ),
    ).rejects.toThrow();
    await expect(
      client.query(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, -1, 'lunch', 'sabzi_dal')`,
        [menu.id, recipe.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects an unrecognised meal_slot', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    const menu = await insertMenu(household.id);

    await expect(
      client.query(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'brunch', 'sabzi_dal')`,
        [menu.id, recipe.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects an unrecognised slot_role, and accepts every real RecipeRole value', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    const menu = await insertMenu(household.id);

    await expect(
      client.query(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'lunch', 'dessert')`,
        [menu.id, recipe.id],
      ),
    ).rejects.toThrow();

    for (const role of ['breakfast', 'carb', 'sabzi_dal', 'accompaniment', 'snack', 'sweet', 'drink']) {
      await expect(
        client.query(
          `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'lunch', $3)`,
          [menu.id, recipe.id, role],
        ),
      ).resolves.toBeDefined();
    }
  });

  it('rejects a second menu for the same (household_id, week_start_date)', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await insertMenu(household.id, '2026-09-07');

    await expect(insertMenu(household.id, '2026-09-07')).rejects.toThrow();
  });

  it('allows two different weeks for the same household', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await insertMenu(household.id, '2026-09-07');

    await expect(insertMenu(household.id, '2026-09-14')).resolves.toBeDefined();
  });

  it('cascades household deletion to menus, and menu deletion to menu_items', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    const menu = await insertMenu(household.id);
    await insertMenuItem(menu.id, recipe.id);

    await client.query(`DELETE FROM households WHERE id = $1`, [household.id]);

    const remainingMenus = await client.query(`SELECT 1 FROM menus WHERE household_id = $1`, [
      household.id,
    ]);
    expect(remainingMenus.rows).toHaveLength(0);
    const remainingItems = await client.query(`SELECT 1 FROM menu_items WHERE menu_id = $1`, [menu.id]);
    expect(remainingItems.rows).toHaveLength(0);
  });

  // E2E_MVP_PLAN.md §15.2.3 — a real, named gap: deleting a recipe that is
  // currently placed in a menu silently removes that slot. Shipped as SD
  // §7.1 specifies (ON DELETE CASCADE), not changed here — this test
  // exists so a future change to that cascade is deliberate, not silent.
  it('cascades recipe deletion to menu_items — a documented gap, not a bug (§15.2.3)', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    const menu = await insertMenu(household.id);
    const item = await insertMenuItem(menu.id, recipe.id);

    await client.query(`DELETE FROM recipes WHERE id = $1`, [recipe.id]);

    const remaining = await client.query(`SELECT 1 FROM menu_items WHERE id = $1`, [item.id]);
    expect(remaining.rows).toHaveLength(0);
  });

  it("allows a household member to read their own household's menu via RLS", async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    const menu = await insertMenu(household.id);

    const asMember = await connectAsRlsProbe(owner.id);
    try {
      const result = await asMember.query(`SELECT id FROM menus WHERE id = $1`, [menu.id]);
      expect(result.rows).toHaveLength(1);
    } finally {
      await asMember.end();
    }
  });

  it("denies a non-member from reading another household's menu via RLS", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const menu = await insertMenu(householdA.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(`SELECT id FROM menus WHERE id = $1`, [menu.id]);
      expect(result.rows).toHaveLength(0);
    } finally {
      await asOutsider.end();
    }
  });

  it('denies a non-member from inserting a menu into another household via RLS', async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      await expect(
        asOutsider.query(`INSERT INTO menus (household_id, week_start_date) VALUES ($1, '2026-09-07')`, [
          householdA.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await asOutsider.end();
    }
  });

  it("denies a non-member from updating another household's menu via RLS", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const menu = await insertMenu(householdA.id, '2026-09-07');

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(`UPDATE menus SET week_start_date = '2026-09-14' WHERE id = $1`, [
        menu.id,
      ]);
      expect(result.rowCount).toBe(0);
    } finally {
      await asOutsider.end();
    }
  });

  // The single most important test in this file (E2E_MVP_PLAN.md §15.2.2,
  // §15.3 S1): `menu_items` has no `household_id` of its own, so this is
  // the direct-query-denial path — a non-member querying `menu_items`
  // straight, never touching `menus` first, must still be denied. This is
  // also exactly the shape `MenuItem.recipe`/list resolution queries as a
  // field resolver with no `householdId` to gate on — RLS is the only
  // guard there, not defense-in-depth.
  it("denies a non-member from reading another household's menu_items by menu_id directly via RLS", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);
    const menu = await insertMenu(householdA.id);
    const item = await insertMenuItem(menu.id, recipe.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const byMenu = await asOutsider.query(`SELECT id FROM menu_items WHERE menu_id = $1`, [menu.id]);
      expect(byMenu.rows).toHaveLength(0);

      const byId = await asOutsider.query(`SELECT id FROM menu_items WHERE id = $1`, [item.id]);
      expect(byId.rows).toHaveLength(0);
    } finally {
      await asOutsider.end();
    }
  });

  it("allows a household member to read their own household's menu_items by menu_id via RLS", async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    const menu = await insertMenu(household.id);
    const item = await insertMenuItem(menu.id, recipe.id);

    const asMember = await connectAsRlsProbe(owner.id);
    try {
      const result = await asMember.query(`SELECT id FROM menu_items WHERE menu_id = $1`, [menu.id]);
      expect(result.rows.map((r) => r.id)).toEqual([item.id]);
    } finally {
      await asMember.end();
    }
  });

  it('denies a non-member from inserting a menu_item referencing another household\'s menu via RLS', async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);
    const menu = await insertMenu(householdA.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      await expect(
        asOutsider.query(
          `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'lunch', 'sabzi_dal')`,
          [menu.id, recipe.id],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await asOutsider.end();
    }
  });

  it('denies a non-member from updating or deleting a menu_item in another household via RLS', async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);
    const menu = await insertMenu(householdA.id);
    const item = await insertMenuItem(menu.id, recipe.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const updated = await asOutsider.query(`UPDATE menu_items SET day_of_week = 3 WHERE id = $1`, [
        item.id,
      ]);
      expect(updated.rowCount).toBe(0);

      const deleted = await asOutsider.query(`DELETE FROM menu_items WHERE id = $1`, [item.id]);
      expect(deleted.rowCount).toBe(0);
    } finally {
      await asOutsider.end();
    }

    const stillThere = await client.query(`SELECT day_of_week FROM menu_items WHERE id = $1`, [item.id]);
    expect(firstRow(stillThere.rows).day_of_week).toBe(1);
  });

  it('lets the real parimaan_app role do full CRUD on menus and menu_items (the grant this migration adds)', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);

    const appUri = new URL(container.getConnectionUri());
    appUri.username = APP_ROLE;
    appUri.password = APP_ROLE_TEST_PASSWORD;
    const appClient = new Client({ connectionString: appUri.toString() });
    await appClient.connect();
    try {
      await appClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [owner.id]);
      const insertedMenu = await appClient.query<{ id: string }>(
        `INSERT INTO menus (household_id, week_start_date) VALUES ($1, '2026-09-07') RETURNING id`,
        [household.id],
      );
      const menuId = firstRow(insertedMenu.rows).id;

      const insertedItem = await appClient.query<{ id: string }>(
        `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'lunch', 'sabzi_dal') RETURNING id`,
        [menuId, recipe.id],
      );
      const itemId = firstRow(insertedItem.rows).id;

      await appClient.query(`UPDATE menu_items SET day_of_week = 2 WHERE id = $1`, [itemId]);

      const selected = await appClient.query(`SELECT day_of_week FROM menu_items WHERE id = $1`, [itemId]);
      expect(firstRow(selected.rows).day_of_week).toBe(2);

      const deletedItem = await appClient.query(`DELETE FROM menu_items WHERE id = $1`, [itemId]);
      expect(deletedItem.rowCount).toBe(1);

      const deletedMenu = await appClient.query(`DELETE FROM menus WHERE id = $1`, [menuId]);
      expect(deletedMenu.rowCount).toBe(1);
    } finally {
      await appClient.end();
    }
  });
});

describe('reversing the menus migration', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  it('leaves no trace of menus or menu_items after up then down, and can be re-run cleanly', async () => {
    await runMigrations(container.getConnectionUri(), 'up');
    await runMigrations(container.getConnectionUri(), 'down');

    expect(await tableExists(client, 'menu_items')).toBe(false);
    expect(await tableExists(client, 'menus')).toBe(false);

    await expect(runMigrations(container.getConnectionUri(), 'up')).resolves.not.toThrow();
    expect(await tableExists(client, 'menus')).toBe(true);
    expect(await tableExists(client, 'menu_items')).toBe(true);
  });
});
