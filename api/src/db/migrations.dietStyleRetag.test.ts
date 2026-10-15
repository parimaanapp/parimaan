import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrationsDir, runMigrations } from './runMigrations.js';
import {
  APP_ROLE_PASSWORD_ENV_VAR,
  APP_ROLE_TEST_PASSWORD,
  POSTGRES_IMAGE,
  insertHousehold,
  insertUser,
} from './migrationTestHelpers.js';
import { RETAG_DIET_STYLES_SQL } from '../../migrations/1788600000000_retag-diet-styles.js';

/**
 * H2 (PR #228 review): forward-only data migration that retags existing
 * households' curated copies, drops `jain` from the potato seeds and gives
 * every style-less recipe an inferred style. Same stop-before-the-migration
 * pattern as `migrations.menuConfigSnapshot.test.ts`.
 */
const migrationFileNames = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();
const retagIndex = migrationFileNames.findIndex((name) => name.includes('retag-diet-styles'));
if (retagIndex === -1) {
  throw new Error('retag-diet-styles migration file not found in api/migrations — test setup assumption broken.');
}

describe('retag-diet-styles data migration', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  let householdId: string;
  let userId: string;

  beforeAll(async () => {
    process.env[APP_ROLE_PASSWORD_ENV_VAR] = APP_ROLE_TEST_PASSWORD;
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    await runMigrations(container.getConnectionUri(), 'up', undefined, [APP_ROLE_TEST_PASSWORD], retagIndex);

    const owner = await insertUser(client);
    userId = owner.id;
    householdId = (await insertHousehold(client, owner.id)).id;
  }, 120_000);

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  const addRecipe = async (
    title: string,
    sourceType: string,
    tags: readonly string[],
    ingredients: readonly string[] = [],
  ): Promise<string> => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO recipes (household_id, source_type, title, role, dietary_tags, created_by)
       VALUES ($1, $2, $3, 'sabzi_dal', $4::jsonb, $5) RETURNING id`,
      [householdId, sourceType, title, JSON.stringify(tags), userId],
    );
    const id = result.rows[0]!.id;
    for (const [index, name] of ingredients.entries()) {
      await client.query(`INSERT INTO recipe_ingredients (recipe_id, name, sort_order) VALUES ($1, $2, $3)`, [id, name, index]);
    }
    return id;
  };

  const tagsOf = async (id: string): Promise<string[]> => {
    const result = await client.query<{ dietary_tags: string[] }>(`SELECT dietary_tags FROM recipes WHERE id = $1`, [id]);
    return [...result.rows[0]!.dietary_tags].sort();
  };

  it('retags curated seeds, leaves user recipes of the same title alone, backfills style-less recipes, and is idempotent', async () => {
    const chicken = await addRecipe('Chicken Curry', 'curated', ['gluten_free', 'dairy_free'], ['Chicken']);
    const butter = await addRecipe('Butter Chicken', 'curated', ['gluten_free'], ['Chicken', 'Butter']);
    const fish = await addRecipe('Kerala Fish Curry (Meen Curry)', 'curated', ['gluten_free', 'dairy_free'], ['Fish']);
    const chettinad = await addRecipe('Chettinad Chicken Curry', 'curated', ['gluten_free', 'dairy_free'], ['Chicken']);
    const alooGobi = await addRecipe('Aloo Gobi', 'curated', ['veg', 'vegan', 'gluten_free', 'jain'], ['Potato', 'Cauliflower']);
    const jeeraAloo = await addRecipe('Jeera Aloo', 'curated', ['veg', 'vegan', 'gluten_free', 'jain'], ['Potato']);
    const userAlooGobi = await addRecipe('Aloo Gobi', 'user', ['veg', 'jain'], ['Potato']);
    const alreadyTagged = await addRecipe('Vegan Bowl', 'user', ['vegan'], ['Chicken']);
    const untaggedVeg = await addRecipe('Plain Rice', 'user', [], ['Rice']);
    const untaggedEgg = await addRecipe('Bhurji', 'user', [], ['Eggs', 'Onion']);
    const untaggedMeat = await addRecipe('Fry', 'user', ['gluten_free'], ['Prawns']);
    const eggless = await addRecipe('Eggless Cake', 'user', [], ['eggless cake batter']);
    const eggplant = await addRecipe('Baingan', 'user', [], ['Eggplant']);

    await runMigrations(container.getConnectionUri(), 'up');

    const expectAll = async (): Promise<void> => {
      expect(await tagsOf(chicken)).toEqual(['dairy_free', 'gluten_free', 'non_veg']);
      expect(await tagsOf(butter)).toEqual(['gluten_free', 'non_veg']);
      expect(await tagsOf(fish)).toEqual(['dairy_free', 'gluten_free', 'non_veg']);
      expect(await tagsOf(chettinad)).toEqual(['dairy_free', 'gluten_free', 'non_veg']);
      expect(await tagsOf(alooGobi)).toEqual(['gluten_free', 'veg', 'vegan']);
      expect(await tagsOf(jeeraAloo)).toEqual(['gluten_free', 'veg', 'vegan']);
      expect(await tagsOf(userAlooGobi)).toEqual(['jain', 'veg']);
      expect(await tagsOf(alreadyTagged)).toEqual(['vegan']);
      expect(await tagsOf(untaggedVeg)).toEqual(['veg']);
      expect(await tagsOf(untaggedEgg)).toEqual(['eggetarian']);
      expect(await tagsOf(untaggedMeat)).toEqual(['gluten_free', 'non_veg']);
      expect(await tagsOf(eggless)).toEqual(['veg']);
      expect(await tagsOf(eggplant)).toEqual(['veg']);
    };

    await expectAll();

    // Idempotent: re-running the data statements changes nothing.
    await client.query(RETAG_DIET_STYLES_SQL);
    await expectAll();
  });
});
