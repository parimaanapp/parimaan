import { describe, expect, it } from 'vitest';
import { buildCatalogIndex } from './ingredientCatalog.js';
import type { CatalogEntry } from './ingredientCatalog.js';
import { createConversionLookup } from './ingredientConversion.js';
import {
  canonicalisePantryItem,
  canonicaliseRecipeLine,
  createCanonicaliser,
} from './canonicaliseIngredient.js';

const entry = (
  id: string,
  canonicalName: string,
  allowedUnits: readonly string[],
  aliases: readonly string[] = [],
): CatalogEntry => ({
  id,
  canonicalName,
  appCategory: 'produce',
  subcategory: 'veg',
  allowedUnits,
  defaultUnit: allowedUnits[0] ?? 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases,
});

const ENTRIES = [
  entry('onion', 'Onion', ['g', 'kg', 'piece'], ['pyaz', 'kanda']),
  entry('rice', 'Basmati Rice', ['g', 'kg'], ['chawal']),
  entry('salt', 'Salt', ['g', 'tsp'], ['namak']),
  entry('magaz_a', 'Pumpkin Seeds', ['g'], ['magaz']),
  entry('magaz_b', 'Watermelon Seeds', ['g'], ['magaz']),
  entry('bread_white', 'Bread (White)', ['slice', 'loaf'], ['white bread']),
];
const context = {
  index: buildCatalogIndex(ENTRIES),
  lookup: createConversionLookup(ENTRIES, [
    { scope: 'ingredient', key: 'rice', unit: 'cup', baseUnit: 'g', amount: 190 },
    { scope: 'ingredient', key: 'onion', unit: 'cup', baseUnit: 'g', amount: 160 },
  ]),
};

const line = (name: string, over: Partial<Parameters<typeof canonicaliseRecipeLine>[0]> = {}) => ({
  name,
  quantity: 1 as number | null,
  unit: 'g' as string | null,
  notes: null as string | null,
  ...over,
});

describe('canonicaliseRecipeLine', () => {
  it('stores the canonical name and id for an alias', () => {
    const result = canonicaliseRecipeLine(line('Pyaz'), context);
    expect(result).toMatchObject({ name: 'Onion', ingredientId: 'onion', catalogMatch: 'resolved' });
  });

  it('keeps an unresolved name as-is and flags it', () => {
    const result = canonicaliseRecipeLine(line('Dragon Fruit Jam'), context);
    expect(result).toMatchObject({ name: 'Dragon Fruit Jam', ingredientId: null, catalogMatch: 'unresolved' });
  });

  it('keeps an ambiguous name as-is and flags it, never picking a candidate', () => {
    const result = canonicaliseRecipeLine(line('magaz'), context);
    expect(result).toMatchObject({ name: 'magaz', ingredientId: null, catalogMatch: 'ambiguous' });
  });

  it('moves a dropped prep parenthetical into the notes instead of losing it', () => {
    const result = canonicaliseRecipeLine(line('Onion (finely chopped)', { notes: 'for tadka' }), context);
    expect(result.name).toBe('Onion');
    expect(result.notes).toBe('for tadka; finely chopped');
  });

  it('does not duplicate a parenthetical the notes already carry', () => {
    const result = canonicaliseRecipeLine(line('Onion (chopped)', { notes: 'Chopped' }), context);
    expect(result.notes).toBe('Chopped');
  });

  it('keeps a parenthetical that is part of the catalog name', () => {
    const result = canonicaliseRecipeLine(line('Bread (White)', { unit: 'slice' }), context);
    expect(result).toMatchObject({ name: 'Bread (White)', ingredientId: 'bread_white', notes: null });
  });

  it('leaves quantity and unit alone when the unit is allowed', () => {
    const result = canonicaliseRecipeLine(line('onion', { quantity: 2, unit: 'piece' }), context);
    expect(result).toMatchObject({ quantity: 2, unit: 'piece', notes: null });
  });

  it('converts a unit the ingredient does not allow when the catalog defines it, and records the original', () => {
    const result = canonicaliseRecipeLine(line('chawal', { quantity: 1.5, unit: 'cup' }), context);
    expect(result).toMatchObject({ name: 'Basmati Rice', quantity: 285, unit: 'g' });
    expect(result.notes).toBe('1.5 cup');
  });

  it('leaves a disallowed unit untouched when no conversion is defined', () => {
    const result = canonicaliseRecipeLine(line('salt', { quantity: 1, unit: 'pinch' }), context);
    expect(result).toMatchObject({ quantity: 1, unit: 'pinch', notes: null });
  });

  it('never converts a missing quantity or unit', () => {
    expect(canonicaliseRecipeLine(line('chawal', { quantity: null, unit: 'cup' }), context)).toMatchObject({
      quantity: null,
      unit: 'cup',
    });
    expect(canonicaliseRecipeLine(line('chawal', { quantity: 2, unit: null }), context)).toMatchObject({
      quantity: 2,
      unit: null,
    });
  });
});

describe('canonicalisePantryItem', () => {
  it('stores the canonical name and id', () => {
    expect(canonicalisePantryItem('kanda', context)).toEqual({
      name: 'Onion',
      ingredientId: 'onion',
      catalogMatch: 'resolved',
    });
  });

  it('keeps the typed name but records the id when a qualifier would be lost', () => {
    expect(canonicalisePantryItem('Onion (red, Nashik)', context)).toEqual({
      name: 'Onion (red, Nashik)',
      ingredientId: 'onion',
      catalogMatch: 'resolved',
    });
  });

  it('flags unresolved and ambiguous names without changing them', () => {
    expect(canonicalisePantryItem('Mystery Powder', context)).toEqual({
      name: 'Mystery Powder',
      ingredientId: null,
      catalogMatch: 'unresolved',
    });
    expect(canonicalisePantryItem('magaz', context).catalogMatch).toBe('ambiguous');
  });
});

describe('createCanonicaliser', () => {
  it('binds the context and exposes the id lookup', () => {
    const canonicaliser = createCanonicaliser(context);
    expect(canonicaliser.ingredientIdFor('Namak')).toBe('salt');
    expect(canonicaliser.ingredientIdFor('magaz')).toBeNull();
    expect(canonicaliser.pantryItem('namak').name).toBe('Salt');
  });
});
