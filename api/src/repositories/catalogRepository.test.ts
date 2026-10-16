import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { startTestDatabase } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { syncCatalog } from '../catalog/syncCatalog.js';
import type { CatalogBundle } from '../catalog/buildBundle.js';
import {
  CATALOG_CACHE_TTL_MS,
  loadCatalog,
  resetCatalogCacheForTesting,
} from './catalogRepository.js';
import { resolveIngredient } from '../domain/ingredientCatalog.js';

const BUNDLE: CatalogBundle = {
  ingredients: [
    {
      id: 'toor_dal',
      canonicalName: 'Toor Dal',
      appCategory: 'dal',
      subcategory: 'dal_pulse',
      allowedUnits: ['g', 'kg', 'cup'],
      defaultUnit: 'g',
      pieceG: null,
      cupG: 200,
      note: 'split pigeon peas',
      aliases: ['tuvar dal', 'arhar dal'],
    },
    {
      id: 'milk',
      canonicalName: 'Milk',
      appCategory: 'dairy',
      subcategory: 'dairy_liquid',
      allowedUnits: ['ml', 'l', 'cup'],
      defaultUnit: 'ml',
      pieceG: null,
      cupG: null,
      note: '',
      aliases: ['doodh'],
    },
  ],
  conversions: [
    { scope: 'ingredient', key: 'toor_dal', unit: 'cup', baseUnit: 'g', amount: 200 },
    { scope: 'subcategory', key: 'dairy_liquid', unit: 'cup', baseUnit: 'ml', amount: 240 },
  ],
};

/** Entries (with aliases) and unit conversions are read by one query each. */
const QUERIES_PER_LOAD = 2;

describe('catalogRepository.loadCatalog', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  });

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  beforeEach(async () => {
    resetCatalogCacheForTesting();
    await db.adminClient.query('DELETE FROM catalog_sync_state');
    await syncCatalog(db.adminClient, BUNDLE);
  });

  it('loads entries with aliases (sorted by alias key) and typed numerics', async () => {
    const catalog = await loadCatalog(pool);

    expect(catalog.entries.map((entry) => entry.id)).toEqual(['milk', 'toor_dal']);
    const toor = catalog.entries.find((entry) => entry.id === 'toor_dal');
    expect(toor).toEqual({
      id: 'toor_dal',
      canonicalName: 'Toor Dal',
      appCategory: 'dal',
      subcategory: 'dal_pulse',
      allowedUnits: ['g', 'kg', 'cup'],
      defaultUnit: 'g',
      pieceG: null,
      cupG: 200,
      note: 'split pigeon peas',
      aliases: ['arhar dal', 'tuvar dal'],
    });
  });

  it('loads unit conversions with numeric amounts and builds a lookup', async () => {
    const catalog = await loadCatalog(pool);
    expect(catalog.conversions).toEqual(
      expect.arrayContaining([
        { scope: 'ingredient', key: 'toor_dal', unit: 'cup', baseUnit: 'g', amount: 200 },
        { scope: 'subcategory', key: 'dairy_liquid', unit: 'cup', baseUnit: 'ml', amount: 240 },
      ]),
    );
    expect(catalog.conversionLookup.factorFor('milk', 'cup')).toEqual({ baseUnit: 'ml', amount: 240 });
    expect(catalog.conversionLookup.factorFor('toor_dal', 'cup')).toEqual({ baseUnit: 'g', amount: 200 });
  });

  it('returns an index that resolves aliases', async () => {
    const catalog = await loadCatalog(pool);
    const result = resolveIngredient('doodh', catalog.index);
    expect(result?.status).toBe('resolved');
  });

  it('serves repeat calls from module memory without querying again', async () => {
    const spy = vi.spyOn(pool, 'query');
    await loadCatalog(pool);
    await loadCatalog(pool);
    await loadCatalog(pool);
    expect(spy).toHaveBeenCalledTimes(QUERIES_PER_LOAD);
    spy.mockRestore();
  });

  it('shares one load between concurrent callers', async () => {
    const spy = vi.spyOn(pool, 'query');
    const [a, b] = await Promise.all([loadCatalog(pool), loadCatalog(pool)]);
    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(QUERIES_PER_LOAD);
    spy.mockRestore();
  });

  it('reloads after the TTL elapses and sees synced changes', async () => {
    const start = 1_000_000;
    const first = await loadCatalog(pool, start);
    expect(first.entries).toHaveLength(2);

    await db.adminClient.query(`UPDATE ingredient_catalog SET note = 'changed' WHERE id = 'milk'`);

    const cached = await loadCatalog(pool, start + CATALOG_CACHE_TTL_MS - 1);
    expect(cached.entries.find((e) => e.id === 'milk')?.note).toBe('');

    const reloaded = await loadCatalog(pool, start + CATALOG_CACHE_TTL_MS + 1);
    expect(reloaded.entries.find((e) => e.id === 'milk')?.note).toBe('changed');
  });

  it('does not cache an empty catalog (sync may not have run yet)', async () => {
    await db.adminClient.query('DELETE FROM ingredient_catalog');
    const empty = await loadCatalog(pool);
    expect(empty.entries).toEqual([]);

    await db.adminClient.query('DELETE FROM catalog_sync_state');
    await syncCatalog(db.adminClient, BUNDLE);
    const filled = await loadCatalog(pool);
    expect(filled.entries).toHaveLength(2);
  });

  it('does not cache a failure', async () => {
    const spy = vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
    await expect(loadCatalog(pool)).rejects.toThrow('db down');
    spy.mockRestore();
    await expect(loadCatalog(pool)).resolves.toBeDefined();
  });
});
