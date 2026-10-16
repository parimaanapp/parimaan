import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { syncCatalog } from './syncCatalog.js';
import { catalogBundle, catalogContentHash } from './bundle.js';
import type { CatalogBundle } from './buildBundle.js';
import { normaliseKey } from '../domain/ingredientCatalog.js';
import type { CatalogEntry } from '../domain/ingredientCatalog.js';

const entry = (overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'canonicalName'>): CatalogEntry => ({
  appCategory: 'dal',
  subcategory: 'dal_pulse',
  allowedUnits: ['g', 'kg', 'cup'],
  defaultUnit: 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases: [],
  ...overrides,
});

const SMALL: CatalogBundle = {
  ingredients: [
    entry({ id: 'toor_dal', canonicalName: 'Toor Dal', cupG: 200, aliases: ['Arhar Dal', 'tuvar dal', 'Arhar  dal.'] }),
    entry({
      id: 'milk',
      canonicalName: 'Milk',
      appCategory: 'dairy',
      subcategory: 'dairy_liquid',
      allowedUnits: ['ml', 'l'],
      defaultUnit: 'ml',
      aliases: ['doodh', 'milk'],
    }),
    entry({ id: 'pumpkin_seeds', canonicalName: 'Pumpkin Seeds', appCategory: 'dry_goods', aliases: ['magaz'] }),
    entry({ id: 'watermelon_seeds', canonicalName: 'Watermelon Seeds', appCategory: 'dry_goods', aliases: ['magaz'] }),
  ],
  conversions: [
    { scope: 'ingredient', key: 'toor_dal', unit: 'cup', baseUnit: 'g', amount: 200 },
    { scope: 'subcategory', key: 'dal_pulse', unit: 'g', baseUnit: 'g', amount: 1 },
  ],
};

describe('syncCatalog (real Postgres)', () => {
  let db: TestDatabase;
  let admin: Client;

  beforeAll(async () => {
    db = await startTestDatabase();
    admin = db.adminClient;
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    await admin.query(
      'TRUNCATE TABLE unit_conversions, ingredient_aliases, ingredient_catalog, catalog_sync_state CASCADE',
    );
  });

  const count = async (table: string): Promise<number> =>
    Number((await admin.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);

  it('loads ingredients, normalised aliases and conversions', async () => {
    const result = await syncCatalog(admin, SMALL);

    expect(result.status).toBe('synced');
    expect(result.hash).toBe(catalogContentHash(SMALL));
    expect(await count('ingredient_catalog')).toBe(4);
    expect(await count('unit_conversions')).toBe(2);

    const toor = await admin.query(`SELECT * FROM ingredient_catalog WHERE id = 'toor_dal'`);
    expect(toor.rows[0]).toMatchObject({
      canonical_name: 'Toor Dal',
      app_category: 'dal',
      subcategory: 'dal_pulse',
      allowed_units: ['g', 'kg', 'cup'],
      default_unit: 'g',
      piece_g: null,
      cup_g: '200',
      note: '',
    });

    const aliases = await admin.query<{ alias_key: string; alias_display: string }>(
      `SELECT alias_key, alias_display FROM ingredient_aliases WHERE ingredient_id = 'toor_dal' ORDER BY alias_key`,
    );
    expect(aliases.rows).toEqual([
      { alias_key: 'arhar dal', alias_display: 'Arhar Dal' },
      { alias_key: 'tuvar dal', alias_display: 'tuvar dal' },
    ]);
  });

  it('skips an alias that normalises to the ingredient own name', async () => {
    await syncCatalog(admin, SMALL);
    const milk = await admin.query(`SELECT alias_key FROM ingredient_aliases WHERE ingredient_id = 'milk'`);
    expect(milk.rows).toEqual([{ alias_key: 'doodh' }]);
  });

  it('keeps colliding aliases for both owners', async () => {
    await syncCatalog(admin, SMALL);
    const rows = await admin.query(
      `SELECT ingredient_id FROM ingredient_aliases WHERE alias_key = 'magaz' ORDER BY ingredient_id`,
    );
    expect(rows.rows).toEqual([{ ingredient_id: 'pumpkin_seeds' }, { ingredient_id: 'watermelon_seeds' }]);
  });

  it('is a no-op when the content hash is unchanged', async () => {
    await syncCatalog(admin, SMALL);
    // A manual tamper must survive a skipped sync, proving nothing was rewritten.
    await admin.query(`UPDATE ingredient_catalog SET note = 'tampered' WHERE id = 'milk'`);

    const second = await syncCatalog(admin, SMALL);

    expect(second.status).toBe('unchanged');
    const note = await admin.query(`SELECT note FROM ingredient_catalog WHERE id = 'milk'`);
    expect(note.rows[0]).toEqual({ note: 'tampered' });
  });

  it('upserts changed rows, adds new ones and removes ingredients, aliases and conversions that left the bundle', async () => {
    await syncCatalog(admin, SMALL);

    const changed: CatalogBundle = {
      ingredients: [
        entry({ id: 'toor_dal', canonicalName: 'Toor Dal', cupG: 210, note: 'updated', aliases: ['arhar dal'] }),
        entry({ id: 'urad_dal', canonicalName: 'Urad Dal', aliases: ['kali dal'] }),
      ],
      conversions: [{ scope: 'ingredient', key: 'toor_dal', unit: 'cup', baseUnit: 'g', amount: 210 }],
    };
    const result = await syncCatalog(admin, changed);

    expect(result.status).toBe('synced');
    const ids = await admin.query(`SELECT id FROM ingredient_catalog ORDER BY id`);
    expect(ids.rows).toEqual([{ id: 'toor_dal' }, { id: 'urad_dal' }]);
    const toor = await admin.query(`SELECT cup_g, note FROM ingredient_catalog WHERE id = 'toor_dal'`);
    expect(toor.rows[0]).toEqual({ cup_g: '210', note: 'updated' });
    const aliasKeys = await admin.query(`SELECT alias_key FROM ingredient_aliases ORDER BY alias_key`);
    expect(aliasKeys.rows).toEqual([{ alias_key: 'arhar dal' }, { alias_key: 'kali dal' }]);
    const conv = await admin.query(`SELECT scope, key, amount FROM unit_conversions`);
    expect(conv.rows).toEqual([{ scope: 'ingredient', key: 'toor_dal', amount: '210' }]);
  });

  it('is idempotent when forced twice with identical data (re-run after hash cleared)', async () => {
    await syncCatalog(admin, SMALL);
    await admin.query('DELETE FROM catalog_sync_state');
    const again = await syncCatalog(admin, SMALL);
    expect(again.status).toBe('synced');
    expect(await count('ingredient_catalog')).toBe(4);
    expect(await count('ingredient_aliases')).toBe(5);
  });

  it('rolls back completely when the bundle is invalid, keeping the previous data and hash', async () => {
    await syncCatalog(admin, SMALL);
    const before = catalogContentHash(SMALL);

    const broken: CatalogBundle = {
      ingredients: [entry({ id: 'toor_dal', canonicalName: 'Toor Dal', defaultUnit: 'cup', allowedUnits: ['g'] })],
      conversions: [],
    };
    await expect(syncCatalog(admin, broken)).rejects.toThrow();

    expect(await count('ingredient_catalog')).toBe(4);
    const state = await admin.query(`SELECT content_hash FROM catalog_sync_state`);
    expect(state.rows).toEqual([{ content_hash: before }]);
  });

  it('handles an empty bundle by clearing the tables', async () => {
    await syncCatalog(admin, SMALL);
    await syncCatalog(admin, { ingredients: [], conversions: [] });
    expect(await count('ingredient_catalog')).toBe(0);
    expect(await count('unit_conversions')).toBe(0);
  });

  it('syncs the real committed bundle, readable by the app role', async () => {
    const result = await syncCatalog(admin, catalogBundle);
    expect(result.status).toBe('synced');
    expect(await count('ingredient_catalog')).toBe(catalogBundle.ingredients.length);
    expect(await count('unit_conversions')).toBe(catalogBundle.conversions.length);

    // No alias dropped: one row per distinct (normalised key, ingredient) pair.
    const pairs = new Set<string>();
    for (const item of catalogBundle.ingredients) {
      const own = normaliseKey(item.canonicalName, { keepParentheticals: true });
      for (const alias of item.aliases) {
        const key = normaliseKey(alias, { keepParentheticals: true });
        if (key !== '' && key !== own) pairs.add(`${key}\u0000${item.id}`);
      }
    }
    expect(await count('ingredient_aliases')).toBe(pairs.size);

    const app = new Client({ connectionString: db.appUri });
    await app.connect();
    try {
      const rows = await app.query(`SELECT canonical_name FROM ingredient_catalog WHERE id = 'toor_dal'`);
      expect(rows.rows).toEqual([{ canonical_name: 'Toor Dal' }]);
    } finally {
      await app.end();
    }
  });

  it('serialises concurrent syncs safely', async () => {
    const other = new Client({ connectionString: db.uri });
    await other.connect();
    try {
      const results = await Promise.all([syncCatalog(admin, SMALL), syncCatalog(other, SMALL)]);
      expect(results.map((r) => r.status).sort()).toEqual(['synced', 'unchanged']);
      expect(await count('ingredient_catalog')).toBe(4);
    } finally {
      await other.end();
    }
  });
});
