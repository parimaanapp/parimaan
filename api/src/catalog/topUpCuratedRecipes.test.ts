import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { IDENTITY_CANONICALISER } from '../domain/canonicaliseIngredient.js';
import type { CuratedRecipeInput } from '../curatedRecipes.js';
import { topUpCuratedRecipes } from './topUpCuratedRecipes.js';

const recipe = (title: string, role: CuratedRecipeInput['role'], salt = false): CuratedRecipeInput => ({
  title,
  description: null,
  servings: 4,
  prepMin: 5,
  cookMin: 10,
  cuisineTier1: 'north_indian',
  cuisineTier2: null,
  dietaryTags: ['veg'],
  role,
  inRotation: true,
  ingredients: [
    { name: 'Onion', quantity: 1, unit: 'piece', category: 'produce', notes: null, isStaple: false },
    ...(salt ? [{ name: 'Salt', quantity: null, unit: null, category: 'spice', notes: null, isStaple: false }] : []),
  ],
  steps: ['Cook.'],
});

const CORPUS: CuratedRecipeInput[] = [recipe('Aloo Gobi', 'sabzi_dal', true), recipe('Jeera Rice', 'carb'), recipe('Poha', 'breakfast')];

describe('topUpCuratedRecipes', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.uri });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const makeHousehold = async (tag: string): Promise<{ householdId: string; userId: string }> => {
    const user = await db.adminClient.query<{ id: string }>(
      `INSERT INTO users (cognito_sub, email) VALUES ($1, $2) RETURNING id`,
      [`sub-${tag}`, `${tag}@example.test`],
    );
    const userId = (user.rows[0] as { id: string }).id;
    const household = await db.adminClient.query<{ id: string }>(
      `INSERT INTO households (name, invite_code, primary_user_id) VALUES ($1, $2, $3) RETURNING id`,
      [`House ${tag}`, tag.toUpperCase().padEnd(6, 'X').slice(0, 6), userId],
    );
    const householdId = (household.rows[0] as { id: string }).id;
    await db.adminClient.query(
      `INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'primary')`,
      [householdId, userId],
    );
    return { householdId, userId };
  };

  const insertExisting = async (householdId: string, userId: string, title: string, role: string, sourceType = 'user') => {
    await db.adminClient.query(
      `INSERT INTO recipes (household_id, source_type, title, role, steps, created_by) VALUES ($1, $2, $3, $4, '[]', $5)`,
      [householdId, sourceType, title, role, userId],
    );
  };

  const titlesOf = async (householdId: string): Promise<string[]> => {
    const result = await db.adminClient.query<{ title: string }>(
      'SELECT title FROM recipes WHERE household_id = $1 ORDER BY title',
      [householdId],
    );
    return result.rows.map((row) => row.title);
  };

  const run = (execute: boolean) =>
    topUpCuratedRecipes({ pool, recipes: CORPUS, canonicaliser: IDENTITY_CANONICALISER, execute });

  it('dry run reports what would be added and writes nothing', async () => {
    const { householdId, userId } = await makeHousehold('dry');
    await insertExisting(householdId, userId, 'Poha', 'breakfast');

    const report = await run(false);

    expect(report.executed).toBe(false);
    expect(report.households).toBe(1);
    expect(report.recipesToAdd).toBe(2);
    expect(await titlesOf(householdId)).toEqual(['Poha']);
  });

  it('execute inserts only the missing recipes, as curated rows owned by the household creator, with ingredients', async () => {
    const { householdId, userId } = await makeHousehold('exec');
    await insertExisting(householdId, userId, 'Poha', 'breakfast', 'user');

    const report = await run(true);

    expect(report.executed).toBe(true);
    expect(report.recipesAdded).toBe(2);
    expect(await titlesOf(householdId)).toEqual(['Aloo Gobi', 'Jeera Rice', 'Poha']);

    const rows = await db.adminClient.query<{ source_type: string; created_by: string; n: string }>(
      `SELECT r.source_type, r.created_by, COUNT(i.id) AS n
         FROM recipes r LEFT JOIN recipe_ingredients i ON i.recipe_id = r.id
        WHERE r.household_id = $1 AND r.title = 'Aloo Gobi' GROUP BY r.source_type, r.created_by`,
      [householdId],
    );
    expect(rows.rows[0]).toMatchObject({ source_type: 'curated', created_by: userId, n: '2' });

    const salt = await db.adminClient.query<{ is_staple: boolean }>(
      `SELECT i.is_staple FROM recipe_ingredients i JOIN recipes r ON r.id = i.recipe_id WHERE r.household_id = $1 AND i.name = 'Salt'`,
      [householdId],
    );
    expect(salt.rows[0]?.is_staple).toBe(true);
  });

  it('is idempotent: a second execute adds nothing', async () => {
    const { householdId } = await makeHousehold('idem');
    await run(true);
    const second = await run(true);

    expect(second.recipesAdded).toBe(0);
    expect(await titlesOf(householdId)).toEqual(['Aloo Gobi', 'Jeera Rice', 'Poha']);
  });

  it('treats the same title under a different role as a different recipe', async () => {
    const { householdId, userId } = await makeHousehold('role');
    await insertExisting(householdId, userId, 'Poha', 'snack');

    await run(true);

    const poha = await db.adminClient.query('SELECT 1 FROM recipes WHERE household_id = $1 AND title = $2', [householdId, 'Poha']);
    expect(poha.rowCount).toBe(2);
  });

  it('tops up every household independently and leaves them isolated', async () => {
    const a = await makeHousehold('hha');
    const b = await makeHousehold('hhb');
    await insertExisting(a.householdId, a.userId, 'Jeera Rice', 'carb');

    const report = await run(true);

    expect(report.households).toBe(2);
    expect(report.recipesAdded).toBe(2 + 3);
    expect(await titlesOf(a.householdId)).toEqual(['Aloo Gobi', 'Jeera Rice', 'Poha']);
    expect(await titlesOf(b.householdId)).toEqual(['Aloo Gobi', 'Jeera Rice', 'Poha']);
  });

  it('refuses to run as a role that cannot bypass row-level security', async () => {
    const appPool = new Pool({ connectionString: db.appUri });
    try {
      await expect(
        topUpCuratedRecipes({ pool: appPool, recipes: CORPUS, canonicaliser: IDENTITY_CANONICALISER, execute: true }),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await appPool.end();
    }
  });
});
