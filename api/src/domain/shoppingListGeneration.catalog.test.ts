import { describe, expect, it } from 'vitest';
import {
  aggregateIngredients,
  excludeItemsAlreadyPreserved,
  ingredientsMatch,
  subtractPantry,
} from './shoppingListGeneration.js';
import type { AggregationMenuItem, AggregationRecipe, RecipeIngredient } from './shoppingListGeneration.js';
import { computeDeductionLines } from './pantryDeduction.js';
import { createConversionLookup, createUnitConverter } from './ingredientConversion.js';
import type { CatalogEntry } from './ingredientCatalog.js';

const entry = (id: string, subcategory = 'veg'): CatalogEntry => ({
  id,
  canonicalName: id,
  appCategory: 'produce',
  subcategory,
  allowedUnits: ['g'],
  defaultUnit: 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases: [],
});

const convert = createUnitConverter(
  createConversionLookup(
    [entry('basmati_rice'), entry('onion')],
    [
      { scope: 'ingredient', key: 'basmati_rice', unit: 'cup', baseUnit: 'g', amount: 190 },
      { scope: 'ingredient', key: 'onion', unit: 'piece', baseUnit: 'g', amount: 110 },
    ],
  ),
);

const ing = (over: Partial<RecipeIngredient>): RecipeIngredient => ({
  name: 'x',
  quantity: 1,
  unit: 'g',
  category: null,
  isStaple: false,
  ...over,
});

const recipe = (id: string, ingredients: RecipeIngredient[]): AggregationRecipe => ({ id, servings: 4, ingredients });
const items = (...ids: string[]): AggregationMenuItem[] =>
  ids.map((recipeId, i) => ({ dayOfWeek: i, mealSlot: 'lunch', recipeId, servingsOverride: null }));

describe('ingredientsMatch', () => {
  it('matches equal ids regardless of the names', () => {
    expect(ingredientsMatch({ name: 'pyaz', ingredientId: 'onion' }, { name: 'onion', ingredientId: 'onion' })).toBe(true);
  });

  it('rejects different ids even when the names are nearly identical', () => {
    expect(
      ingredientsMatch({ name: 'tomato puree', ingredientId: 'tomato_puree' }, { name: 'tomato pure', ingredientId: 'tomato_paste' }),
    ).toBe(false);
  });

  it('falls back to the name when either side has no id', () => {
    expect(ingredientsMatch({ name: 'onion', ingredientId: 'onion' }, { name: 'onion', ingredientId: null })).toBe(true);
    expect(ingredientsMatch({ name: 'onion', ingredientId: null }, { name: 'garlic', ingredientId: null })).toBe(false);
  });
});

describe('aggregateIngredients with catalog ids', () => {
  const recipes = new Map([
    ['r1', recipe('r1', [ing({ name: 'Basmati Rice', ingredientId: 'basmati_rice', quantity: 1, unit: 'cup' })])],
    ['r2', recipe('r2', [ing({ name: 'Basmati Rice', ingredientId: 'basmati_rice', quantity: 190, unit: 'g' })])],
    ['r3', recipe('r3', [ing({ name: 'Rice Flour', ingredientId: 'rice_flour', quantity: 100, unit: 'g' })])],
  ]);

  it('merges one ingredient across units through catalog conversions', () => {
    const result = aggregateIngredients(items('r1', 'r2'), recipes, convert);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Basmati Rice', unit: 'cup', quantity: 2, ingredientId: 'basmati_rice' });
  });

  it('keeps the units apart when the catalog defines no conversion', () => {
    const result = aggregateIngredients(items('r1', 'r2'), recipes);
    expect(result).toHaveLength(2);
  });

  it('never merges different ids that look alike', () => {
    const result = aggregateIngredients(items('r2', 'r3'), recipes, convert);
    expect(result).toHaveLength(2);
  });

  it('keeps staples out of the list', () => {
    const staples = new Map([
      [
        'r1',
        recipe('r1', [
          ing({ name: 'Salt', ingredientId: 'salt', quantity: 1, unit: 'tsp', isStaple: true }),
          ing({ name: 'Black Pepper', ingredientId: 'black_pepper', quantity: 5, unit: 'g', category: 'spice' }),
          ing({ name: 'Onion', ingredientId: 'onion', quantity: 2, unit: 'piece' }),
        ]),
      ],
    ]);
    expect(aggregateIngredients(items('r1'), staples, convert).map((i) => i.name)).toEqual(['Onion']);
  });
});

describe('subtractPantry with catalog ids', () => {
  const needed = [
    { name: 'Onion', quantity: 4, unit: 'piece', category: null, sourceRecipeId: 'r1', ingredientId: 'onion' },
  ];

  it('matches the pantry by id when the names differ', () => {
    const result = subtractPantry(needed, [{ name: 'Kanda', quantity: 3, unit: 'piece', ingredientId: 'onion' }], convert);
    expect(result).toMatchObject([{ quantity: 1 }]);
  });

  it('subtracts across units via the catalog', () => {
    const result = subtractPantry(needed, [{ name: 'Onion', quantity: 220, unit: 'g', ingredientId: 'onion' }], convert);
    expect(result).toMatchObject([{ quantity: 2 }]);
  });

  it('leaves the line alone when the unit conversion is unknown', () => {
    const result = subtractPantry(needed, [{ name: 'Onion', quantity: 220, unit: 'g', ingredientId: 'onion' }]);
    expect(result).toMatchObject([{ quantity: 4 }]);
  });

  it('still matches by name when the pantry row has no id', () => {
    const result = subtractPantry(needed, [{ name: 'onion', quantity: 4, unit: 'piece', ingredientId: null }], convert);
    expect(result).toEqual([]);
  });
});

describe('excludeItemsAlreadyPreserved and deduction with catalog ids', () => {
  it('treats a preserved item with the same id as already present', () => {
    const fresh = [{ name: 'Onion', unit: 'piece', ingredientId: 'onion' }];
    const preserved = [{ name: 'Kanda', unit: 'piece', ingredientId: 'onion' }];
    expect(excludeItemsAlreadyPreserved(fresh, preserved)).toEqual([]);
  });

  it('deducts from the pantry row with the same id', () => {
    const lines = computeDeductionLines(
      { servings: 4, ingredients: [ing({ name: 'Onion', ingredientId: 'onion', quantity: 2, unit: 'piece' })] },
      null,
      [{ id: 'p1', name: 'Kanda', quantity: 5, unit: 'piece', ingredientId: 'onion' }],
      convert,
    );
    expect(lines).toEqual([{ pantryItemId: 'p1', newQuantity: 3 }]);
  });
});
