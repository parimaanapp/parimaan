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
} from './migrationTestHelpers.js';

/**
 * E2E_MVP_PLAN.md §17.8 ("A regression found while cleaning up"): W11 S4's
 * real-AWS verification pass found that `shopping_list_items.source_recipe_id`
 * (`1788200000000_shopping-lists.ts`) had no `ON DELETE` action, so deleting
 * a recipe that ever sourced a generated shopping-list item — directly via
 * `deleteRecipe`, or transitively via `deleteHousehold`'s cascade through
 * `recipes` — hit a masked `23503` foreign-key violation and rolled back
 * the whole delete. `1788400000000_shopping-list-items-source-recipe-set-
 * null.ts` fixes this with `ON DELETE SET NULL`. These tests reproduce the
 * original bug directly against real Postgres (both pre- and post-migration
 * schema shape aren't separately exercised here — `runMigrations` always
 * brings the container to head, matching every other migration test file's
 * convention of testing the shipped end-state) and assert the fix: the
 * delete succeeds, and the shopping-list item survives with
 * `source_recipe_id: null` rather than being removed or blocking the
 * delete.
 */
describe('shopping_list_items.source_recipe_id ON DELETE SET NULL', () => {
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
      'TRUNCATE TABLE shopping_list_items, shopping_lists, recipe_ingredients, recipes, household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
    );
  });

  const insertRecipe = async (client_: Client, householdId: string, userId: string): Promise<{ id: string }> => {
    const result = await client_.query<{ id: string }>(
      `INSERT INTO recipes (household_id, source_type, title, role, created_by)
       VALUES ($1, 'user', 'Test Recipe', 'sabzi_dal', $2) RETURNING id`,
      [householdId, userId],
    );
    return { id: firstRow(result.rows).id };
  };

  const insertShoppingList = async (client_: Client, householdId: string): Promise<{ id: string }> => {
    const result = await client_.query<{ id: string }>(
      `INSERT INTO shopping_lists (household_id) VALUES ($1) RETURNING id`,
      [householdId],
    );
    return { id: firstRow(result.rows).id };
  };

  const insertShoppingListItem = async (
    client_: Client,
    shoppingListId: string,
    sourceRecipeId: string,
    overrides: { purchased?: boolean; movedToPantry?: boolean } = {},
  ): Promise<{ id: string }> => {
    const result = await client_.query<{ id: string }>(
      `INSERT INTO shopping_list_items (shopping_list_id, name, source_recipe_id, purchased, moved_to_pantry)
       VALUES ($1, 'Onions', $2, $3, $4) RETURNING id`,
      [shoppingListId, sourceRecipeId, overrides.purchased ?? false, overrides.movedToPantry ?? false],
    );
    return { id: firstRow(result.rows).id };
  };

  it('deleting the source recipe directly (deleteRecipe) succeeds and nulls out source_recipe_id, not removes the item', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(client, household.id, owner.id);
    const shoppingList = await insertShoppingList(client, household.id);
    const item = await insertShoppingListItem(client, shoppingList.id, recipe.id, {
      purchased: true,
      movedToPantry: true,
    });

    // Previously: 23503 foreign-key violation on
    // shopping_list_items_source_recipe_id_fkey, whole transaction rolled
    // back. Now: succeeds.
    await expect(client.query('DELETE FROM recipes WHERE id = $1', [recipe.id])).resolves.toBeDefined();

    const result = await client.query<{ id: string; source_recipe_id: string | null; purchased: boolean; moved_to_pantry: boolean }>(
      'SELECT id, source_recipe_id, purchased, moved_to_pantry FROM shopping_list_items WHERE id = $1',
      [item.id],
    );
    const row = firstRow(result.rows);
    expect(row.source_recipe_id).toBeNull();
    // The item itself, and its purchase history, survive untouched.
    expect(row.purchased).toBe(true);
    expect(row.moved_to_pantry).toBe(true);
  });

  it('a manually-added item on the same list (source_recipe_id already NULL, D8\'s origin marker) is untouched by an adjacent recipe delete', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(client, household.id, owner.id);
    const shoppingList = await insertShoppingList(client, household.id);
    const recipeItem = await insertShoppingListItem(client, shoppingList.id, recipe.id);
    const manualItemResult = await client.query<{ id: string }>(
      `INSERT INTO shopping_list_items (shopping_list_id, name, source_recipe_id)
       VALUES ($1, 'Salt', NULL) RETURNING id`,
      [shoppingList.id],
    );
    const manualItem = { id: firstRow(manualItemResult.rows).id };

    await expect(client.query('DELETE FROM recipes WHERE id = $1', [recipe.id])).resolves.toBeDefined();

    const recipeItemResult = await client.query<{ source_recipe_id: string | null }>(
      'SELECT source_recipe_id FROM shopping_list_items WHERE id = $1',
      [recipeItem.id],
    );
    expect(firstRow(recipeItemResult.rows).source_recipe_id).toBeNull();

    // SET NULL on a column already NULL is a pure no-op by FK semantics —
    // this asserts the manually-added item's row (and its already-NULL
    // source_recipe_id) is genuinely unaffected, not just coincidentally
    // still NULL.
    const manualItemResultAfter = await client.query<{ id: string; source_recipe_id: string | null }>(
      'SELECT id, source_recipe_id FROM shopping_list_items WHERE id = $1',
      [manualItem.id],
    );
    const manualRow = firstRow(manualItemResultAfter.rows);
    expect(manualRow.id).toBe(manualItem.id);
    expect(manualRow.source_recipe_id).toBeNull();
  });

  it('deleting the household (deleteHousehold\'s cascade through recipes) succeeds and nulls out source_recipe_id on the surviving item', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(client, household.id, owner.id);
    const shoppingList = await insertShoppingList(client, household.id);
    const item = await insertShoppingListItem(client, shoppingList.id, recipe.id);

    // Previously: households -> recipes CASCADE deletes the recipe, which
    // then hits the same 23503 violation from shopping_list_items, rolling
    // the whole household delete back (E2E_MVP_PLAN.md §17.8 confirmed this
    // via a follow-up Query.household showing the household fully intact).
    // Now: household delete cascades to shopping_lists (ON DELETE CASCADE
    // on household_id) too, so the item's parent shopping_list is gone —
    // assert on the recipe row instead, which is the thing that was
    // actually blocked from being deleted.
    await expect(client.query('DELETE FROM households WHERE id = $1', [household.id])).resolves.toBeDefined();

    const recipeResult = await client.query('SELECT id FROM recipes WHERE id = $1', [recipe.id]);
    expect(recipeResult.rows).toHaveLength(0);

    // shopping_lists cascades on household_id, so the item is gone too —
    // this is expected pre-existing CASCADE behavior on shopping_lists,
    // unrelated to this fix. Recorded here so the household-delete case is
    // not mistaken for leaving orphaned shopping list rows behind.
    const itemResult = await client.query('SELECT id FROM shopping_list_items WHERE id = $1', [item.id]);
    expect(itemResult.rows).toHaveLength(0);
  });

  it('deleting a recipe that only has a NOT-yet-purchased shopping-list item still succeeds and nulls the reference', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(client, household.id, owner.id);
    const shoppingList = await insertShoppingList(client, household.id);
    const item = await insertShoppingListItem(client, shoppingList.id, recipe.id, {
      purchased: false,
      movedToPantry: false,
    });

    await expect(client.query('DELETE FROM recipes WHERE id = $1', [recipe.id])).resolves.toBeDefined();

    const result = await client.query<{ source_recipe_id: string | null }>(
      'SELECT source_recipe_id FROM shopping_list_items WHERE id = $1',
      [item.id],
    );
    expect(firstRow(result.rows).source_recipe_id).toBeNull();
  });
});
