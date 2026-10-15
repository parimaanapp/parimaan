import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { startTestDatabase } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { syncCatalog } from './syncCatalog.js';
import type { CatalogBundle } from './buildBundle.js';
import { resetCatalogCacheForTesting, loadCatalog } from '../repositories/catalogRepository.js';
import { createCanonicaliser } from '../domain/canonicaliseIngredient.js';
import { assertCanBypassRowSecurity, formatBackfillReport, runIngredientBackfill } from './backfillIngredients.js';

const BUNDLE: CatalogBundle = {
  ingredients: [
    {
      id: 'onion',
      canonicalName: 'Onion',
      appCategory: 'produce',
      subcategory: 'veg',
      allowedUnits: ['g', 'piece'],
      defaultUnit: 'g',
      pieceG: null,
      cupG: null,
      note: '',
      aliases: ['pyaz', 'kanda'],
    },
    {
      id: 'basmati_rice',
      canonicalName: 'Basmati Rice',
      appCategory: 'grain',
      subcategory: 'rice',
      allowedUnits: ['g', 'kg'],
      defaultUnit: 'g',
      pieceG: null,
      cupG: null,
      note: '',
      aliases: ['chawal'],
    },
  ],
  conversions: [{ scope: 'ingredient', key: 'basmati_rice', unit: 'cup', baseUnit: 'g', amount: 190 }],
};

describe('runIngredientBackfill', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
    await syncCatalog(db.adminClient, BUNDLE);
    resetCatalogCacheForTesting();

    const admin = db.adminClient;
    const user = await admin.query(
      `INSERT INTO users (cognito_sub, email) VALUES ('sub-backfill', 'backfill@example.test') RETURNING id`,
    );
    const userId = user.rows[0].id as string;
    const house = await admin.query(
      `INSERT INTO households (name, invite_code, primary_user_id) VALUES ('H', 'BKF234', $1) RETURNING id`,
      [userId],
    );
    const householdId = house.rows[0].id as string;
    const recipe = await admin.query(
      `INSERT INTO recipes (household_id, source_type, title, servings, role, steps, created_by, dietary_tags)
       VALUES ($1, 'user', 'Pulao', 4, 'carb', '[]', $2, '[]') RETURNING id`,
      [householdId, userId],
    );
    const recipeId = recipe.rows[0].id as string;
    await admin.query(
      `INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, notes, sort_order) VALUES
         ($1, 'Pyaz (chopped)', 2, 'piece', NULL, 0),
         ($1, 'chawal', 1, 'cup', NULL, 1),
         ($1, 'Dragon Jam', 1, 'jar', NULL, 2)`,
      [recipeId],
    );
    await admin.query(
      `INSERT INTO pantry_items (household_id, name, quantity, unit, added_by) VALUES
         ($1, 'kanda', 3, 'piece', $2), ($1, 'Mystery Powder', 1, 'packet', $2)`,
      [householdId, userId],
    );
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  const canonicaliser = async () => {
    const snapshot = await loadCatalog(pool);
    return createCanonicaliser({ index: snapshot.index, lookup: snapshot.conversionLookup });
  };

  const recipeState = async () =>
    (
      await db.adminClient.query(
        `SELECT name, quantity::float AS quantity, unit, notes, ingredient_id, catalog_match
           FROM recipe_ingredients ORDER BY sort_order`,
      )
    ).rows;

  it('refuses to run as a role that cannot see every household', async () => {
    const appClient = await pool.connect();
    try {
      await expect(assertCanBypassRowSecurity(appClient)).rejects.toThrow(/bypasses row-level security/);
    } finally {
      appClient.release();
    }
  });

  it('dry run reports what would change and writes nothing', async () => {
    const before = await recipeState();
    const report = await runIngredientBackfill(db.adminClient, await canonicaliser(), { execute: false });

    expect(report.executed).toBe(false);
    expect(report.recipeIngredients).toMatchObject({ scanned: 3, changed: 3, resolved: 2, unresolved: 1 });
    expect(report.pantryItems).toMatchObject({ scanned: 2, changed: 2, resolved: 1, unresolved: 1 });
    expect(report.topUnmatched.map((item) => item.name).sort()).toEqual(['dragon jam', 'mystery powder']);
    expect(await recipeState()).toEqual(before);
    expect(formatBackfillReport(report)).toContain('DRY RUN');
  });

  it('execute canonicalises both tables; a second run changes nothing', async () => {
    const first = await runIngredientBackfill(db.adminClient, await canonicaliser(), { execute: true, batchSize: 2 });
    expect(first.executed).toBe(true);
    expect(first.recipeIngredients.changed).toBe(3);

    expect(await recipeState()).toEqual([
      { name: 'Onion', quantity: 2, unit: 'piece', notes: 'chopped', ingredient_id: 'onion', catalog_match: 'resolved' },
      { name: 'Basmati Rice', quantity: 190, unit: 'g', notes: '1 cup', ingredient_id: 'basmati_rice', catalog_match: 'resolved' },
      { name: 'Dragon Jam', quantity: 1, unit: 'jar', notes: null, ingredient_id: null, catalog_match: 'unresolved' },
    ]);
    const pantry = await db.adminClient.query(
      `SELECT name, ingredient_id, catalog_match FROM pantry_items ORDER BY name`,
    );
    expect(pantry.rows).toEqual([
      { name: 'Mystery Powder', ingredient_id: null, catalog_match: 'unresolved' },
      { name: 'Onion', ingredient_id: 'onion', catalog_match: 'resolved' },
    ]);

    const second = await runIngredientBackfill(db.adminClient, await canonicaliser(), { execute: true });
    expect(second.recipeIngredients.changed).toBe(0);
    expect(second.pantryItems.changed).toBe(0);
  });
});
