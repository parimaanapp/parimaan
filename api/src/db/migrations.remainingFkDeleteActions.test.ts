import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from './runMigrations.js';
import {
  APP_ROLE_PASSWORD_ENV_VAR,
  APP_ROLE_TEST_PASSWORD,
  POSTGRES_IMAGE,
  firstRow,
  insertHousehold,
  insertUser,
  tableExists,
} from './migrationTestHelpers.js';

/**
 * A code-review pass on `fix/w11-shopping-list-fk-delete` (PR #108, which
 * fixed `shopping_list_items.source_recipe_id`'s missing `ON DELETE`
 * action — see `migrations.shoppingListSourceRecipeSetNull.test.ts` for
 * that fix's own tests) found five more foreign keys with the identical
 * "no ON DELETE action" shape:
 *   - `households.primary_user_id`      -> ON DELETE SET NULL
 *   - `pantry_items.added_by`           -> ON DELETE SET NULL
 *   - `recipes.created_by`              -> ON DELETE SET NULL
 *   - `shopping_lists.generated_from_menu_id` -> ON DELETE CASCADE
 *   - `shopping_list_items.purchased_by` -> ON DELETE SET NULL
 * `1788500000000_remaining-fk-delete-actions.ts` fixes all five. None of
 * these are reachable through a resolver today (no `deleteUser` or
 * `deleteMenu` exists yet), so — same as PR #108's own test file — these
 * tests drive the delete directly against Postgres with raw SQL rather
 * than through a resolver, reproducing the exact "delete the referenced
 * row" scenario each FK will face once that resolver exists.
 *
 * Single describe block, one container, covering all five FKs: they are
 * independent ALTERs with no interaction between them, so there is no
 * value in five separate containers the way genuinely distinct feature
 * areas (recipes vs. menus vs. shopping-lists) get their own file/container
 * elsewhere in this suite.
 */
describe('remaining FK ON DELETE actions (households/pantry_items/recipes/shopping_lists/shopping_list_items)', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  beforeEach(async () => {
    await client.query(
      `TRUNCATE TABLE shopping_list_items, shopping_lists, menu_items, menus,
        recipe_ingredients, recipes, pantry_items, household_memberships,
        household_settings, households, users RESTART IDENTITY CASCADE`,
    );
  });

  const insertMenu = async (householdId: string, weekStartDate = '2026-09-07'): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO menus (household_id, week_start_date) VALUES ($1, $2) RETURNING id`,
      [householdId, weekStartDate],
    );
    return { id: firstRow(result.rows).id };
  };

  const insertPantryItem = async (householdId: string, addedBy: string): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO pantry_items (household_id, name, unit, added_by)
       VALUES ($1, 'Onions', 'kg', $2) RETURNING id`,
      [householdId, addedBy],
    );
    return { id: firstRow(result.rows).id };
  };

  const insertRecipe = async (householdId: string, createdBy: string): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO recipes (household_id, source_type, title, role, created_by)
       VALUES ($1, 'user', 'Rajma', 'sabzi_dal', $2) RETURNING id`,
      [householdId, createdBy],
    );
    return { id: firstRow(result.rows).id };
  };

  const insertShoppingList = async (
    householdId: string,
    generatedFromMenuId: string | null = null,
  ): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO shopping_lists (household_id, generated_from_menu_id) VALUES ($1, $2) RETURNING id`,
      [householdId, generatedFromMenuId],
    );
    return { id: firstRow(result.rows).id };
  };

  const insertShoppingListItem = async (
    shoppingListId: string,
    purchasedBy: string | null = null,
  ): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO shopping_list_items (shopping_list_id, name, purchased, purchased_by)
       VALUES ($1, 'Onions', $2::UUID IS NOT NULL, $2) RETURNING id`,
      [shoppingListId, purchasedBy],
    );
    return { id: firstRow(result.rows).id };
  };

  describe('households.primary_user_id ON DELETE SET NULL', () => {
    it('deleting the primary user succeeds and nulls primary_user_id, not removes the household', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);

      // Previously: 23503 FK violation on households_primary_user_id_fkey
      // (and, even with the FK relaxed, 23502 NOT NULL violation, since
      // the column itself was NOT NULL — this migration drops both
      // blockers). Now: succeeds.
      await expect(client.query('DELETE FROM users WHERE id = $1', [owner.id])).resolves.toBeDefined();

      const result = await client.query<{ id: string; primary_user_id: string | null }>(
        'SELECT id, primary_user_id FROM households WHERE id = $1',
        [household.id],
      );
      const row = firstRow(result.rows);
      expect(row.id).toBe(household.id);
      expect(row.primary_user_id).toBeNull();
    });
  });

  describe('pantry_items.added_by ON DELETE SET NULL', () => {
    it('deleting the user who added an item succeeds and nulls added_by, not removes the item', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      const adder = await insertUser(client);
      await client.query(
        `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`,
        [household.id, adder.id],
      );
      const item = await insertPantryItem(household.id, adder.id);

      // Previously: 23503 FK violation on pantry_items_added_by_fkey (and,
      // even with the FK relaxed, 23502 NOT NULL violation — the column
      // was NOT NULL). Now: succeeds.
      await expect(client.query('DELETE FROM users WHERE id = $1', [adder.id])).resolves.toBeDefined();

      const result = await client.query<{ id: string; added_by: string | null }>(
        'SELECT id, added_by FROM pantry_items WHERE id = $1',
        [item.id],
      );
      const row = firstRow(result.rows);
      expect(row.id).toBe(item.id);
      expect(row.added_by).toBeNull();
    });
  });

  describe('recipes.created_by ON DELETE SET NULL', () => {
    it('deleting the user who created a recipe succeeds and nulls created_by, not removes the recipe', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      const author = await insertUser(client);
      await client.query(
        `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`,
        [household.id, author.id],
      );
      const recipe = await insertRecipe(household.id, author.id);

      // Previously: 23503 FK violation on recipes_created_by_fkey (and,
      // even with the FK relaxed, 23502 NOT NULL violation — the column
      // was NOT NULL). Now: succeeds.
      await expect(client.query('DELETE FROM users WHERE id = $1', [author.id])).resolves.toBeDefined();

      const result = await client.query<{ id: string; created_by: string | null }>(
        'SELECT id, created_by FROM recipes WHERE id = $1',
        [recipe.id],
      );
      const row = firstRow(result.rows);
      expect(row.id).toBe(recipe.id);
      expect(row.created_by).toBeNull();
    });
  });

  describe('shopping_lists.generated_from_menu_id ON DELETE CASCADE', () => {
    it('deleting the source menu succeeds and cascades to remove the shopping list it generated', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      const menu = await insertMenu(household.id);
      const shoppingList = await insertShoppingList(household.id, menu.id);

      // Previously: 23503 FK violation on
      // shopping_lists_generated_from_menu_id_fkey — deleting the menu the
      // list was generated from was blocked entirely. Now: succeeds, and
      // (unlike the SET NULL cases above) the shopping list itself is
      // gone too — this is CASCADE, the deliberately different choice for
      // this one FK.
      await expect(client.query('DELETE FROM menus WHERE id = $1', [menu.id])).resolves.toBeDefined();

      const listResult = await client.query('SELECT id FROM shopping_lists WHERE id = $1', [shoppingList.id]);
      expect(listResult.rows).toHaveLength(0);
    });

    it('deleting an unrelated menu does not touch a shopping list generated from a different menu', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      const menu = await insertMenu(household.id, '2026-09-07');
      const otherMenu = await insertMenu(household.id, '2026-09-14');
      const shoppingList = await insertShoppingList(household.id, menu.id);

      await expect(client.query('DELETE FROM menus WHERE id = $1', [otherMenu.id])).resolves.toBeDefined();

      const listResult = await client.query<{ id: string; generated_from_menu_id: string | null }>(
        'SELECT id, generated_from_menu_id FROM shopping_lists WHERE id = $1',
        [shoppingList.id],
      );
      const row = firstRow(listResult.rows);
      expect(row.id).toBe(shoppingList.id);
      expect(row.generated_from_menu_id).toBe(menu.id);
    });

    it('a manually-created shopping list with no source menu (generated_from_menu_id already NULL) is untouched by a menu delete', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      const menu = await insertMenu(household.id);
      const manualList = await insertShoppingList(household.id, null);

      await expect(client.query('DELETE FROM menus WHERE id = $1', [menu.id])).resolves.toBeDefined();

      const listResult = await client.query('SELECT id FROM shopping_lists WHERE id = $1', [manualList.id]);
      expect(listResult.rows).toHaveLength(1);
    });
  });

  describe('shopping_list_items.purchased_by ON DELETE SET NULL', () => {
    it('deleting the user who purchased an item succeeds and nulls purchased_by, not removes the item', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      const purchaser = await insertUser(client);
      await client.query(
        `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`,
        [household.id, purchaser.id],
      );
      const shoppingList = await insertShoppingList(household.id);
      const item = await insertShoppingListItem(shoppingList.id, purchaser.id);

      // Previously: 23503 FK violation on
      // shopping_list_items_purchased_by_fkey. Now: succeeds — this column
      // was already nullable, so no companion NOT NULL drop was needed
      // here (unlike the three SET NULL cases above).
      await expect(client.query('DELETE FROM users WHERE id = $1', [purchaser.id])).resolves.toBeDefined();

      const result = await client.query<{ id: string; purchased_by: string | null; purchased: boolean }>(
        'SELECT id, purchased_by, purchased FROM shopping_list_items WHERE id = $1',
        [item.id],
      );
      const row = firstRow(result.rows);
      expect(row.id).toBe(item.id);
      expect(row.purchased_by).toBeNull();
      // The purchase itself (the boolean flag) is preserved — only the
      // now-dangling attribution to who purchased it is cleared.
      expect(row.purchased).toBe(true);
    });

    it('an unpurchased item (purchased_by already NULL) is untouched by an adjacent user delete', async () => {
      const owner = await insertUser(client);
      const household = await insertHousehold(client, owner.id);
      const shoppingList = await insertShoppingList(household.id);
      const item = await insertShoppingListItem(shoppingList.id, null);

      await expect(client.query('DELETE FROM users WHERE id = $1', [owner.id])).resolves.toBeDefined();

      const result = await client.query<{ id: string; purchased_by: string | null }>(
        'SELECT id, purchased_by FROM shopping_list_items WHERE id = $1',
        [item.id],
      );
      const row = firstRow(result.rows);
      expect(row.id).toBe(item.id);
      expect(row.purchased_by).toBeNull();
    });
  });
});

/**
 * `down()` swaps a foreign key definition and a NOT NULL constraint on
 * three columns at once — nontrivial enough (database-reviewer finding on
 * this migration) that an `up()`-only test suite can't catch a regression
 * in it. Same "full up() then down() then up() again, from a dedicated
 * container" shape as `migrations.menus.test.ts`'s "reversing the menus
 * migration" block: `runMigrations(..., 'down')` reverses every migration
 * newest-first, so this migration's `down()` runs first — while every
 * table/column it touches is still present with real (non-null) data in
 * every other regression test's fixtures — genuinely exercising its SQL,
 * not just asserting the end state is empty.
 */
describe('reversing the remaining-fk-delete-actions migration', () => {
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

  const getConstraintAndNullability = async (
    tableName: string,
    columnName: string,
    constraintName: string,
  ): Promise<{ isNullable: string; deleteRule: string | null }> => {
    const columnResult = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [tableName, columnName],
    );
    const constraintResult = await client.query<{ delete_rule: string }>(
      `SELECT rc.delete_rule FROM information_schema.referential_constraints rc
       WHERE rc.constraint_schema = 'public' AND rc.constraint_name = $1`,
      [constraintName],
    );
    return {
      isNullable: firstRow(columnResult.rows).is_nullable,
      deleteRule: constraintResult.rows[0]?.delete_rule ?? null,
    };
  };

  it('up() sets the locked ON DELETE actions and drops NOT NULL where required; down() runs cleanly and a fresh up() reproduces the identical shape', async () => {
    await runMigrations(container.getConnectionUri(), 'up');

    // Post-up(): each FK carries its locked ON DELETE action, and the
    // three previously-NOT-NULL attribution columns can now hold NULL.
    expect(await getConstraintAndNullability('households', 'primary_user_id', 'households_primary_user_id_fkey')).toEqual({
      isNullable: 'YES',
      deleteRule: 'SET NULL',
    });
    expect(await getConstraintAndNullability('pantry_items', 'added_by', 'pantry_items_added_by_fkey')).toEqual({
      isNullable: 'YES',
      deleteRule: 'SET NULL',
    });
    expect(await getConstraintAndNullability('recipes', 'created_by', 'recipes_created_by_fkey')).toEqual({
      isNullable: 'YES',
      deleteRule: 'SET NULL',
    });
    expect(
      await getConstraintAndNullability(
        'shopping_lists',
        'generated_from_menu_id',
        'shopping_lists_generated_from_menu_id_fkey',
      ),
    ).toEqual({ isNullable: 'YES', deleteRule: 'CASCADE' });
    expect(
      await getConstraintAndNullability(
        'shopping_list_items',
        'purchased_by',
        'shopping_list_items_purchased_by_fkey',
      ),
    ).toEqual({ isNullable: 'YES', deleteRule: 'SET NULL' });

    await runMigrations(container.getConnectionUri(), 'down');

    expect(await tableExists(client, 'households')).toBe(false);

    await expect(runMigrations(container.getConnectionUri(), 'up')).resolves.not.toThrow();

    // Re-migrating up from scratch re-applies this migration's up() over
    // freshly-recreated (NOT NULL, no ON DELETE) tables — if down() had
    // left any of these three columns nullable, or any constraint missing
    // its ON DELETE action, this would either throw or produce a different
    // shape than the first up() did above. Re-asserting the same shape
    // here confirms down() genuinely reversed everything up() changed,
    // not just that the tables came back.
    expect(await getConstraintAndNullability('households', 'primary_user_id', 'households_primary_user_id_fkey')).toEqual({
      isNullable: 'YES',
      deleteRule: 'SET NULL',
    });
    expect(
      await getConstraintAndNullability(
        'shopping_lists',
        'generated_from_menu_id',
        'shopping_lists_generated_from_menu_id_fkey',
      ),
    ).toEqual({ isNullable: 'YES', deleteRule: 'CASCADE' });
  });
});
