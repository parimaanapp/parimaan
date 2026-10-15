import type { Pool } from 'pg';
import { buildCatalogIndex } from '../domain/ingredientCatalog.js';
import type { CatalogEntry, CatalogIndex } from '../domain/ingredientCatalog.js';

export interface CatalogSnapshot {
  readonly entries: readonly CatalogEntry[];
  readonly index: CatalogIndex;
}

/**
 * The catalog only changes on deploy (the sync runs in the migration runner),
 * but Lambda containers outlive deploys for a while, so a snapshot is reused
 * for at most this long before it is re-read.
 */
export const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

interface CatalogRow {
  id: string;
  canonical_name: string;
  app_category: string;
  subcategory: string;
  allowed_units: string[];
  default_unit: string;
  piece_g: string | null;
  cup_g: string | null;
  note: string;
  aliases: string[];
}

let cached: { snapshot: CatalogSnapshot; loadedAt: number } | undefined;
let inFlight: Promise<CatalogSnapshot> | undefined;

/** Test hook: forgets the module-level cache. */
export const resetCatalogCacheForTesting = (): void => {
  cached = undefined;
  inFlight = undefined;
};

const toNumberOrNull = (value: string | null): number | null => (value === null ? null : Number(value));

const readCatalog = async (pool: Pool): Promise<CatalogSnapshot> => {
  const result = await pool.query<CatalogRow>(
    `SELECT c.id, c.canonical_name, c.app_category, c.subcategory, c.allowed_units,
            c.default_unit, c.piece_g, c.cup_g, c.note,
            COALESCE(
              ARRAY(
                SELECT a.alias_display FROM ingredient_aliases a
                 WHERE a.ingredient_id = c.id
                 ORDER BY a.alias_key
              ),
              ARRAY[]::text[]
            ) AS aliases
       FROM ingredient_catalog c
      ORDER BY c.id`,
  );
  const entries: CatalogEntry[] = result.rows.map((row) => ({
    id: row.id,
    canonicalName: row.canonical_name,
    appCategory: row.app_category,
    subcategory: row.subcategory,
    allowedUnits: row.allowed_units,
    defaultUnit: row.default_unit,
    pieceG: toNumberOrNull(row.piece_g),
    cupG: toNumberOrNull(row.cup_g),
    note: row.note,
    aliases: row.aliases,
  }));
  return { entries, index: buildCatalogIndex(entries) };
};

/**
 * Returns the whole catalog (global reference data, no household scope),
 * cached in module memory per Lambda container. Concurrent callers share one
 * load; failures and empty results are not cached, so a request arriving
 * before the first sync has populated the tables does not pin an empty list.
 * `now` is injectable for tests.
 */
export const loadCatalog = async (pool: Pool, now: number = Date.now()): Promise<CatalogSnapshot> => {
  if (cached !== undefined && now - cached.loadedAt < CATALOG_CACHE_TTL_MS) {
    return cached.snapshot;
  }
  if (inFlight !== undefined) {
    return inFlight;
  }
  const pending = readCatalog(pool)
    .then((snapshot) => {
      if (snapshot.entries.length > 0) {
        cached = { snapshot, loadedAt: now };
      }
      return snapshot;
    })
    .finally(() => {
      inFlight = undefined;
    });
  inFlight = pending;
  return pending;
};
