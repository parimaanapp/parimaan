import { describe, expect, it } from 'vitest';
import { createConversionLookup, createUnitConverter, defaultUnitConverter } from './ingredientConversion.js';
import type { CatalogEntry } from './ingredientCatalog.js';

const entry = (id: string, subcategory: string): CatalogEntry => ({
  id,
  canonicalName: id,
  appCategory: 'grain',
  subcategory,
  allowedUnits: ['g', 'kg'],
  defaultUnit: 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases: [],
});

const lookup = createConversionLookup(
  [entry('rice', 'grain_rice'), entry('onion', 'veg_bulb'), entry('mystery', 'nothing')],
  [
    { scope: 'ingredient', key: 'rice', unit: 'cup', baseUnit: 'g', amount: 190 },
    { scope: 'subcategory', key: 'grain_rice', unit: 'cup', baseUnit: 'g', amount: 999 },
    { scope: 'subcategory', key: 'grain_rice', unit: 'tbsp', baseUnit: 'g', amount: 12 },
    { scope: 'ingredient', key: 'onion', unit: 'piece', baseUnit: 'g', amount: 110 },
    { scope: 'ingredient', key: 'onion', unit: 'cup', baseUnit: 'g', amount: 160 },
  ],
);
const convert = createUnitConverter(lookup);

describe('createConversionLookup', () => {
  it('prefers an ingredient-scope factor over its subcategory factor', () => {
    expect(lookup.factorFor('rice', 'cup')).toEqual({ baseUnit: 'g', amount: 190 });
  });

  it('falls back to the subcategory factor', () => {
    expect(lookup.factorFor('rice', 'tbsp')).toEqual({ baseUnit: 'g', amount: 12 });
  });

  it('returns null for an unknown unit, ingredient or null id', () => {
    expect(lookup.factorFor('rice', 'bunch')).toBeNull();
    expect(lookup.factorFor('nope', 'cup')).toBeNull();
    expect(lookup.factorFor(null, 'cup')).toBeNull();
  });
});

describe('createUnitConverter', () => {
  it('keeps the physical families working without an ingredient', () => {
    expect(convert(null, 1, 'kg', 'g')).toBe(1000);
    expect(defaultUnitConverter(null, 2, 'dozen', 'piece')).toBe(24);
  });

  it('converts across families through the ingredient factor', () => {
    expect(convert('rice', 2, 'cup', 'g')).toBe(380);
    expect(convert('rice', 380, 'g', 'cup')).toBe(2);
    expect(convert('rice', 1, 'cup', 'kg')).toBeCloseTo(0.19);
    expect(convert('onion', 2, 'piece', 'cup')).toBeCloseTo(220 / 160);
  });

  it('returns null where the catalog defines nothing, never a guess', () => {
    expect(convert('mystery', 1, 'cup', 'g')).toBeNull();
    expect(convert(null, 1, 'cup', 'g')).toBeNull();
    expect(convert('rice', 1, 'bunch', 'g')).toBeNull();
    expect(convert('rice', 1, 'piece', 'cup')).toBeNull();
  });

  it('is the identity for the same unit', () => {
    expect(convert('mystery', 3, 'bunch', 'bunch')).toBe(3);
  });
});
