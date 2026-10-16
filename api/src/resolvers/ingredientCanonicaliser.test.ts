import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildCatalogIndex } from '../domain/ingredientCatalog.js';
import type { CatalogEntry } from '../domain/ingredientCatalog.js';
import { createConversionLookup } from '../domain/ingredientConversion.js';
import { IDENTITY_CANONICALISER } from '../domain/canonicaliseIngredient.js';
import type { CatalogSnapshot } from '../repositories/catalogRepository.js';
import { loadIngredientCanonicaliser, loadUnitConverter } from './ingredientCanonicaliser.js';

const onion: CatalogEntry = {
  id: 'onion',
  canonicalName: 'Onion',
  appCategory: 'produce',
  subcategory: 'veg',
  allowedUnits: ['g', 'piece'],
  defaultUnit: 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases: ['pyaz'],
};

const snapshot = (entries: readonly CatalogEntry[]): CatalogSnapshot => {
  const conversions = [{ scope: 'ingredient', key: 'onion', unit: 'piece', baseUnit: 'g', amount: 110 }] as const;
  return {
    entries,
    index: buildCatalogIndex(entries),
    conversions,
    conversionLookup: createConversionLookup(entries, conversions),
  };
};

const pool = {} as Pool;

describe('loadIngredientCanonicaliser', () => {
  it('builds a canonicaliser from the loaded catalog', async () => {
    const canonicaliser = await loadIngredientCanonicaliser(pool, () => Promise.resolve(snapshot([onion])));
    expect(canonicaliser.pantryItem('pyaz')).toMatchObject({ name: 'Onion', ingredientId: 'onion' });
  });

  it('falls back to the identity canonicaliser when the catalog cannot be read, so a save never fails', async () => {
    const error = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const canonicaliser = await loadIngredientCanonicaliser(pool, () => Promise.reject(new Error('db down')));
    expect(canonicaliser).toBe(IDENTITY_CANONICALISER);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ event: 'catalog_unavailable', error: 'db down' });
    error.mockRestore();
  });

  it('falls back to identity when the catalog is empty (sync not run yet)', async () => {
    const canonicaliser = await loadIngredientCanonicaliser(pool, () => Promise.resolve(snapshot([])));
    expect(canonicaliser).toBe(IDENTITY_CANONICALISER);
  });
});

describe('loadUnitConverter', () => {
  it('returns a catalog-aware converter', async () => {
    const convert = await loadUnitConverter(pool, () => Promise.resolve(snapshot([onion])));
    expect(convert?.('onion', 2, 'piece', 'g')).toBe(220);
  });

  it('returns undefined (physical families only) when the catalog cannot be read', async () => {
    const error = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await loadUnitConverter(pool, () => Promise.reject(new Error('db down')))).toBeUndefined();
    error.mockRestore();
  });
});
