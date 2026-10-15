import type { Pool } from 'pg';
import { IDENTITY_CANONICALISER, createCanonicaliser } from '../domain/canonicaliseIngredient.js';
import type { IngredientCanonicaliser } from '../domain/canonicaliseIngredient.js';
import { createUnitConverter } from '../domain/ingredientConversion.js';
import type { UnitConverter } from '../domain/ingredientConversion.js';
import { loadCatalog } from '../repositories/catalogRepository.js';
import type { CatalogSnapshot } from '../repositories/catalogRepository.js';

/** What a resolver needs from the catalog; injectable so resolver tests do not need a database. */
export type CanonicaliserLoader = (pool: Pool) => Promise<IngredientCanonicaliser>;
export type CatalogSnapshotLoader = (pool: Pool) => Promise<CatalogSnapshot>;

/**
 * Loads the (module-cached) catalog and builds the write-side canonicaliser.
 * Canonicalisation is an enrichment, never a gate: if the catalog cannot be
 * read, or is empty because the first deploy sync has not run, the save
 * proceeds with the names as typed and `catalog_match` left NULL, and the
 * backfill classifies the rows later.
 */
export const loadIngredientCanonicaliser = async (
  pool: Pool,
  load: CatalogSnapshotLoader = (target) => loadCatalog(target),
): Promise<IngredientCanonicaliser> => {
  try {
    const snapshot = await load(pool);
    if (snapshot.entries.length === 0) {
      return IDENTITY_CANONICALISER;
    }
    return createCanonicaliser({ index: snapshot.index, lookup: snapshot.conversionLookup });
  } catch (error: unknown) {
    console.error('Ingredient catalog unavailable; saving without canonicalisation:', error);
    return IDENTITY_CANONICALISER;
  }
};

export interface CatalogTools {
  readonly canonicaliser: IngredientCanonicaliser;
  /** `undefined` = physical unit families only. */
  readonly convert: UnitConverter | undefined;
}

/** Canonicaliser and unit converter from one catalog load, for paths that need both (have-it, purchase, shopping list). */
export const loadCatalogTools = async (
  pool: Pool,
  load: CatalogSnapshotLoader = (target) => loadCatalog(target),
): Promise<CatalogTools> => {
  try {
    const snapshot = await load(pool);
    if (snapshot.entries.length === 0) {
      return { canonicaliser: IDENTITY_CANONICALISER, convert: undefined };
    }
    return {
      canonicaliser: createCanonicaliser({ index: snapshot.index, lookup: snapshot.conversionLookup }),
      convert: createUnitConverter(snapshot.conversionLookup),
    };
  } catch (error: unknown) {
    console.error('Ingredient catalog unavailable; continuing without it:', error);
    return { canonicaliser: IDENTITY_CANONICALISER, convert: undefined };
  }
};

/** Catalog-aware unit converter for read paths; `undefined` (physical families only) when the catalog is unavailable. */
export const loadUnitConverter = async (
  pool: Pool,
  load: CatalogSnapshotLoader = (target) => loadCatalog(target),
): Promise<UnitConverter | undefined> => {
  try {
    const snapshot = await load(pool);
    return snapshot.entries.length === 0 ? undefined : createUnitConverter(snapshot.conversionLookup);
  } catch (error: unknown) {
    console.error('Ingredient catalog unavailable; using physical unit conversions only:', error);
    return undefined;
  }
};
