import { randomUUID } from 'node:crypto';
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
 * Split out of `migrations.test.ts` (the file-organization 800-line cap) —
 * same Testcontainers-per-describe-block pattern, sharing helpers via
 * `migrationTestHelpers.ts` rather than duplicating them.
 */
describe('recipes and recipe_ingredients, once migrated', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  // Same non-owner, non-superuser probe-role approach as `pantry_items`'s
  // RLS tests in `migrations.test.ts`, granted only what this migration's
  // own `GRANT` gives `parimaan_app`, so these tests also stand in as a
  // check that the grant is sufficient.
  const rlsProbeRole = 'recipes_rls_probe_role';
  const rlsProbePassword = 'recipes_rls_probe_password';

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    await runMigrations(container.getConnectionUri(), 'up');
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await client.query(`CREATE ROLE ${rlsProbeRole} LOGIN PASSWORD '${rlsProbePassword}'`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON recipes, recipe_ingredients, household_memberships TO ${rlsProbeRole}`,
    );
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  beforeEach(async () => {
    await client.query(
      'TRUNCATE TABLE recipe_ingredients, recipes, household_memberships, household_settings, households, users RESTART IDENTITY CASCADE',
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

  /** A membership is required for every RLS assertion below — the policy has no other way in. */
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

  const insertIngredient = async (recipeId: string): Promise<{ id: string }> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO recipe_ingredients (recipe_id, name) VALUES ($1, $2) RETURNING id`,
      [recipeId, 'Rajma beans'],
    );
    return firstRow(result.rows);
  };

  it('creates the recipes table with the expected columns and types', async () => {
    const columns = await getColumnTypes(client, 'recipes');
    expect(columns).toMatchObject({
      id: 'uuid',
      household_id: 'uuid',
      source_type: 'text',
      source_url: 'text',
      source_raw_text: 'text',
      title: 'text',
      description: 'text',
      servings: 'integer',
      prep_min: 'integer',
      cook_min: 'integer',
      cuisine_tier1: 'text',
      cuisine_tier2: 'text',
      dietary_tags: 'jsonb',
      role: 'text',
      in_rotation: 'boolean',
      is_favorite: 'boolean',
      steps: 'jsonb',
      created_by: 'uuid',
      created_at: 'timestamp with time zone',
      updated_at: 'timestamp with time zone',
    });
  });

  it('creates the recipe_ingredients table with the expected columns and types, and no household_id', async () => {
    const columns = await getColumnTypes(client, 'recipe_ingredients');
    expect(columns).toMatchObject({
      id: 'uuid',
      recipe_id: 'uuid',
      name: 'text',
      quantity: 'numeric',
      unit: 'text',
      category: 'text',
      notes: 'text',
      is_staple: 'boolean',
      sort_order: 'integer',
    });
    expect(columns.household_id).toBeUndefined();
  });

  it('rejects a recipe with an unknown role', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await expect(
      client.query(
        `INSERT INTO recipes (household_id, source_type, title, role, created_by) VALUES ($1, 'user', $2, 'dessert', $3)`,
        [household.id, 'Bad Role Recipe', owner.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects a recipe with an unknown cuisine_tier1, and accepts NULL', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await expect(
      client.query(
        `INSERT INTO recipes (household_id, source_type, title, role, cuisine_tier1, created_by) VALUES ($1, 'user', $2, 'sabzi_dal', 'italian', $3)`,
        [household.id, 'Bad Cuisine Recipe', owner.id],
      ),
    ).rejects.toThrow();

    await expect(insertRecipe(household.id, owner.id)).resolves.toBeDefined();
  });

  it('rejects a recipe referencing a non-existent household_id', async () => {
    const owner = await insertUser(client);
    await expect(insertRecipe(randomUUID(), owner.id)).rejects.toThrow();
  });

  it('rejects a recipe referencing a non-existent created_by user', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await expect(insertRecipe(household.id, randomUUID())).rejects.toThrow();
  });

  it('cascades household deletion to recipes, and recipe deletion to recipe_ingredients', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    await insertIngredient(recipe.id);

    await client.query(`DELETE FROM households WHERE id = $1`, [household.id]);

    const remainingRecipes = await client.query(`SELECT 1 FROM recipes WHERE household_id = $1`, [
      household.id,
    ]);
    expect(remainingRecipes.rows).toHaveLength(0);

    const remainingIngredients = await client.query(
      `SELECT 1 FROM recipe_ingredients WHERE recipe_id = $1`,
      [recipe.id],
    );
    expect(remainingIngredients.rows).toHaveLength(0);
  });

  it("allows a household member to read their own household's recipes via RLS", async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);

    const asMember = await connectAsRlsProbe(owner.id);
    try {
      const result = await asMember.query(`SELECT id FROM recipes WHERE id = $1`, [recipe.id]);
      expect(result.rows).toHaveLength(1);
    } finally {
      await asMember.end();
    }
  });

  it("denies a non-member from reading another household's recipes via RLS", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(`SELECT id FROM recipes WHERE id = $1`, [recipe.id]);
      expect(result.rows).toHaveLength(0);
    } finally {
      await asOutsider.end();
    }
  });

  it('denies a non-member from inserting a recipe into another household via RLS', async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      await expect(
        asOutsider.query(
          `INSERT INTO recipes (household_id, source_type, title, role, created_by) VALUES ($1, 'user', $2, 'sabzi_dal', $3)`,
          [householdA.id, 'Sneaked-in Recipe', ownerB.id],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await asOutsider.end();
    }
  });

  it("denies a non-member from updating another household's recipe via RLS", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(`UPDATE recipes SET title = 'Hijacked' WHERE id = $1`, [
        recipe.id,
      ]);
      expect(result.rowCount).toBe(0);
    } finally {
      await asOutsider.end();
    }

    const unchanged = await client.query<{ title: string }>(`SELECT title FROM recipes WHERE id = $1`, [
      recipe.id,
    ]);
    expect(firstRow(unchanged.rows).title).toBe('Rajma');
  });

  it("denies a non-member from deleting another household's recipe via RLS", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(`DELETE FROM recipes WHERE id = $1`, [recipe.id]);
      expect(result.rowCount).toBe(0);
    } finally {
      await asOutsider.end();
    }

    const stillThere = await client.query(`SELECT 1 FROM recipes WHERE id = $1`, [recipe.id]);
    expect(stillThere.rows).toHaveLength(1);
  });

  // The single most important test in this slice (E2E_MVP_PLAN.md §12.2.2,
  // §12.5.2): `recipe_ingredients` has no `household_id` column and is not
  // covered by `recipes`' own RLS policy — Postgres RLS is per-table, so a
  // policy on `recipes` does nothing for a direct `SELECT ... FROM
  // recipe_ingredients WHERE recipe_id = $1`. This is also exactly the
  // shape `Recipe.ingredients` queries as a field resolver with no
  // `householdId` argument to gate on (§12.2.7/§12.2.2) — RLS is the only
  // guard there, not defense-in-depth.
  it("denies a non-member from reading another household's recipe_ingredients by recipe_id directly via RLS", async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);
    const ingredient = await insertIngredient(recipe.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const result = await asOutsider.query(
        `SELECT id FROM recipe_ingredients WHERE recipe_id = $1`,
        [recipe.id],
      );
      expect(result.rows).toHaveLength(0);

      const byIngredientId = await asOutsider.query(
        `SELECT id FROM recipe_ingredients WHERE id = $1`,
        [ingredient.id],
      );
      expect(byIngredientId.rows).toHaveLength(0);
    } finally {
      await asOutsider.end();
    }
  });

  it("allows a household member to read their own household's recipe_ingredients by recipe_id via RLS", async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);
    const recipe = await insertRecipe(household.id, owner.id);
    const ingredient = await insertIngredient(recipe.id);

    const asMember = await connectAsRlsProbe(owner.id);
    try {
      const result = await asMember.query(
        `SELECT id FROM recipe_ingredients WHERE recipe_id = $1`,
        [recipe.id],
      );
      expect(result.rows.map((r) => r.id)).toEqual([ingredient.id]);
    } finally {
      await asMember.end();
    }
  });

  it('denies a non-member from inserting a recipe_ingredient referencing another household\'s recipe via RLS', async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      await expect(
        asOutsider.query(`INSERT INTO recipe_ingredients (recipe_id, name) VALUES ($1, $2)`, [
          recipe.id,
          'Sneaked-in Ingredient',
        ]),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await asOutsider.end();
    }
  });

  it('denies a non-member from updating or deleting a recipe_ingredient in another household via RLS', async () => {
    const ownerA = await insertUser(client);
    const ownerB = await insertUser(client);
    const householdA = await insertHousehold(client, ownerA.id);
    const householdB = await insertHousehold(client, ownerB.id);
    await addMember(householdA.id, ownerA.id);
    await addMember(householdB.id, ownerB.id);
    const recipe = await insertRecipe(householdA.id, ownerA.id);
    const ingredient = await insertIngredient(recipe.id);

    const asOutsider = await connectAsRlsProbe(ownerB.id);
    try {
      const updated = await asOutsider.query(
        `UPDATE recipe_ingredients SET name = 'Hijacked' WHERE id = $1`,
        [ingredient.id],
      );
      expect(updated.rowCount).toBe(0);

      const deleted = await asOutsider.query(`DELETE FROM recipe_ingredients WHERE id = $1`, [
        ingredient.id,
      ]);
      expect(deleted.rowCount).toBe(0);
    } finally {
      await asOutsider.end();
    }

    const stillThere = await client.query(`SELECT name FROM recipe_ingredients WHERE id = $1`, [
      ingredient.id,
    ]);
    expect(firstRow(stillThere.rows).name).toBe('Rajma beans');
  });

  it('lets the real parimaan_app role do full CRUD on recipes and recipe_ingredients (the grant this migration adds)', async () => {
    const owner = await insertUser(client);
    const household = await insertHousehold(client, owner.id);
    await addMember(household.id, owner.id);

    const appUri = new URL(container.getConnectionUri());
    appUri.username = APP_ROLE;
    appUri.password = APP_ROLE_TEST_PASSWORD;
    const appClient = new Client({ connectionString: appUri.toString() });
    await appClient.connect();
    try {
      await appClient.query(`SELECT set_config('parimaan.user_id', $1, false)`, [owner.id]);
      const insertedRecipe = await appClient.query<{ id: string }>(
        `INSERT INTO recipes (household_id, source_type, title, role, created_by) VALUES ($1, 'user', $2, 'sabzi_dal', $3) RETURNING id`,
        [household.id, 'Rajma', owner.id],
      );
      const recipeId = firstRow(insertedRecipe.rows).id;

      const insertedIngredient = await appClient.query<{ id: string }>(
        `INSERT INTO recipe_ingredients (recipe_id, name) VALUES ($1, $2) RETURNING id`,
        [recipeId, 'Rajma beans'],
      );
      const ingredientId = firstRow(insertedIngredient.rows).id;

      await appClient.query(`UPDATE recipes SET title = 'Rajma Chawal' WHERE id = $1`, [recipeId]);
      await appClient.query(`UPDATE recipe_ingredients SET name = 'Kidney beans' WHERE id = $1`, [
        ingredientId,
      ]);

      const selectedIngredient = await appClient.query(
        `SELECT id FROM recipe_ingredients WHERE id = $1`,
        [ingredientId],
      );
      expect(selectedIngredient.rows).toHaveLength(1);

      const deletedIngredient = await appClient.query(
        `DELETE FROM recipe_ingredients WHERE id = $1`,
        [ingredientId],
      );
      expect(deletedIngredient.rowCount).toBe(1);

      const deletedRecipe = await appClient.query(`DELETE FROM recipes WHERE id = $1`, [recipeId]);
      expect(deletedRecipe.rowCount).toBe(1);
    } finally {
      await appClient.end();
    }
  });
});

describe('reversing the recipes migration', () => {
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

  it('leaves no trace of recipes or recipe_ingredients after up then down, and can be re-run cleanly', async () => {
    await runMigrations(container.getConnectionUri(), 'up');
    await runMigrations(container.getConnectionUri(), 'down');

    expect(await tableExists(client, 'recipe_ingredients')).toBe(false);
    expect(await tableExists(client, 'recipes')).toBe(false);

    // Re-running the whole set from scratch must not throw — the concrete
    // regression this guards is a down() that leaves some artifact (a
    // policy, a grant) that makes the *next* up() fail.
    await expect(runMigrations(container.getConnectionUri(), 'up')).resolves.not.toThrow();
    expect(await tableExists(client, 'recipes')).toBe(true);
    expect(await tableExists(client, 'recipe_ingredients')).toBe(true);
  });
});
