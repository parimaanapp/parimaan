import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCatalogBundle, serialiseBundleFile } from './buildBundle.js';
import { CATALOG_SOURCE_FILES, CATALOG_BUNDLE_FILES } from './sourceFiles.js';
import { catalogBundle, catalogContentHash } from './bundle.js';
import { buildCatalogIndex, resolveIngredient } from '../domain/ingredientCatalog.js';

const read = (path: string): string => readFileSync(path, 'utf8');

const expected = (): ReturnType<typeof buildCatalogBundle> =>
  buildCatalogBundle(read(CATALOG_SOURCE_FILES.ingredients), read(CATALOG_SOURCE_FILES.conversions));

describe('committed catalog bundle', () => {
  it('ingredients.json is in sync with docs/catalog/ingredients.csv (run `pnpm --filter ./api catalog:build`)', () => {
    expect(read(CATALOG_BUNDLE_FILES.ingredients)).toBe(serialiseBundleFile(expected().ingredients));
  });

  it('conversions.json is in sync with docs/catalog/conversions.csv (run `pnpm --filter ./api catalog:build`)', () => {
    expect(read(CATALOG_BUNDLE_FILES.conversions)).toBe(serialiseBundleFile(expected().conversions));
  });

  it('the loaded bundle equals the CSV-derived bundle', () => {
    expect(catalogBundle).toEqual(expected());
  });

  it('is non-empty and has unique ids and canonical names', () => {
    const { ingredients } = catalogBundle;
    expect(ingredients.length).toBeGreaterThan(0);
    expect(new Set(ingredients.map((item) => item.id)).size).toBe(ingredients.length);
    expect(new Set(ingredients.map((item) => item.canonicalName.toLowerCase())).size).toBe(
      ingredients.length,
    );
  });

  it('every ingredient resolves to itself by canonical name', () => {
    const index = buildCatalogIndex(catalogBundle.ingredients);
    for (const entry of catalogBundle.ingredients) {
      const result = resolveIngredient(entry.canonicalName, index);
      expect(result?.status, entry.id).toBe('resolved');
      if (result?.status === 'resolved') {
        expect(result.entry.id).toBe(entry.id);
      }
    }
  });

  it('resolves the founder-signed-off aliases against the real data', () => {
    const index = buildCatalogIndex(catalogBundle.ingredients);
    const idFor = (name: string): string | undefined => {
      const result = resolveIngredient(name, index);
      return result?.status === 'resolved' ? result.entry.id : undefined;
    };
    expect(idFor('arhar dal')).toBe('toor_dal');
    expect(idFor('tuvar')).toBe('toor_dal');
    expect(idFor('lal mirch')).toBe('red_chilli_powder');
    expect(idFor('kashmiri lal mirch powder')).toBe('red_chilli_powder');
    expect(idFor('doodh')).toBe('milk');
  });
});

describe('catalogContentHash', () => {
  it('is a stable sha256 hex digest', () => {
    expect(catalogContentHash(catalogBundle)).toMatch(/^[0-9a-f]{64}$/);
    expect(catalogContentHash(catalogBundle)).toBe(catalogContentHash(catalogBundle));
  });

  it('changes when any ingredient field changes', () => {
    const [first, ...rest] = catalogBundle.ingredients;
    if (first === undefined) {
      throw new Error('bundle is empty');
    }
    const changed = {
      ...catalogBundle,
      ingredients: [{ ...first, note: `${first.note} changed` }, ...rest],
    };
    expect(catalogContentHash(changed)).not.toBe(catalogContentHash(catalogBundle));
  });

  it('changes when a conversion changes', () => {
    const [first, ...rest] = catalogBundle.conversions;
    if (first === undefined) {
      throw new Error('bundle has no conversions');
    }
    const changed = {
      ...catalogBundle,
      conversions: [{ ...first, amount: first.amount + 1 }, ...rest],
    };
    expect(catalogContentHash(changed)).not.toBe(catalogContentHash(catalogBundle));
  });
});
