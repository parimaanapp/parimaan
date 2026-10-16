import { describe, expect, it } from 'vitest';
import { buildCatalogIndex } from './ingredientCatalog.js';
import type { CatalogEntry } from './ingredientCatalog.js';
import { createConversionLookup } from './ingredientConversion.js';
import { createCanonicaliser, IDENTITY_CANONICALISER } from './canonicaliseIngredient.js';
import { planPantryBackfill, planRecipeIngredientBackfill } from './ingredientBackfill.js';
import type { PantryBackfillRow, RecipeIngredientBackfillRow } from './ingredientBackfill.js';
import { catalogBundle } from '../catalog/bundle.js';

const entry = (id: string, name: string, units: string[], aliases: string[] = []): CatalogEntry => ({
  id,
  canonicalName: name,
  appCategory: 'produce',
  subcategory: 'veg',
  allowedUnits: units,
  defaultUnit: units[0] ?? 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases,
});

const ENTRIES = [
  entry('onion', 'Onion', ['g', 'piece'], ['pyaz']),
  entry('rice', 'Basmati Rice', ['g'], ['chawal']),
  entry('seeds_a', 'Pumpkin Seeds', ['g'], ['magaz']),
  entry('seeds_b', 'Watermelon Seeds', ['g'], ['magaz']),
];
const canonicaliser = createCanonicaliser({
  index: buildCatalogIndex(ENTRIES),
  lookup: createConversionLookup(ENTRIES, [{ scope: 'ingredient', key: 'rice', unit: 'cup', baseUnit: 'g', amount: 190 }]),
});

const recipeRow = (over: Partial<RecipeIngredientBackfillRow>): RecipeIngredientBackfillRow => ({
  id: 'r1',
  name: 'pyaz',
  quantity: 2,
  unit: 'piece',
  notes: null,
  ingredientId: null,
  catalogMatch: null,
  ...over,
});

const pantryRow = (over: Partial<PantryBackfillRow>): PantryBackfillRow => ({
  id: 'p1',
  name: 'pyaz',
  ingredientId: null,
  catalogMatch: null,
  ...over,
});

describe('planRecipeIngredientBackfill', () => {
  it('canonicalises a legacy row', () => {
    expect(planRecipeIngredientBackfill(recipeRow({}), canonicaliser)).toEqual({
      id: 'r1',
      name: 'Onion',
      quantity: 2,
      unit: 'piece',
      notes: null,
      ingredientId: 'onion',
      catalogMatch: 'resolved',
    });
  });

  it('classifies an unresolved row without changing its text', () => {
    const update = planRecipeIngredientBackfill(recipeRow({ name: 'Mystery' }), canonicaliser);
    expect(update).toMatchObject({ name: 'Mystery', ingredientId: null, catalogMatch: 'unresolved' });
  });

  it('classifies an ambiguous row without picking a candidate', () => {
    const update = planRecipeIngredientBackfill(recipeRow({ name: 'magaz' }), canonicaliser);
    expect(update).toMatchObject({ name: 'magaz', ingredientId: null, catalogMatch: 'ambiguous' });
  });

  it('is idempotent: applying the plan again plans nothing', () => {
    const first = planRecipeIngredientBackfill(
      recipeRow({ name: 'chawal (washed)', quantity: 1, unit: 'cup', notes: 'soak' }),
      canonicaliser,
    );
    expect(first).toMatchObject({ name: 'Basmati Rice', quantity: 190, unit: 'g', notes: 'soak; washed; 1 cup' });
    const applied = { ...recipeRow({}), ...first } as RecipeIngredientBackfillRow;
    expect(planRecipeIngredientBackfill(applied, canonicaliser)).toBeNull();
  });

  it('plans nothing when the catalog is unavailable', () => {
    expect(planRecipeIngredientBackfill(recipeRow({}), IDENTITY_CANONICALISER)).toBeNull();
  });

  it('re-resolves a previously unresolved row once the catalog knows it', () => {
    const update = planRecipeIngredientBackfill(
      recipeRow({ name: 'pyaz', ingredientId: null, catalogMatch: 'unresolved' }),
      canonicaliser,
    );
    expect(update).toMatchObject({ ingredientId: 'onion', catalogMatch: 'resolved' });
  });
});

describe('planPantryBackfill', () => {
  it('canonicalises a legacy row and is idempotent', () => {
    const first = planPantryBackfill(pantryRow({}), canonicaliser);
    expect(first).toEqual({ id: 'p1', name: 'Onion', ingredientId: 'onion', catalogMatch: 'resolved' });
    expect(planPantryBackfill({ ...pantryRow({}), ...first } as PantryBackfillRow, canonicaliser)).toBeNull();
  });

  it('keeps a typed qualifier but records the id', () => {
    const update = planPantryBackfill(pantryRow({ name: 'Pyaz (red)' }), canonicaliser);
    expect(update).toMatchObject({ name: 'Pyaz (red)', ingredientId: 'onion', catalogMatch: 'resolved' });
  });
});

describe('rows pointing at an ingredient merged away (catalog dedupe)', () => {
  // The deploy sync deletes the merged ingredient; `ON DELETE SET NULL` leaves
  // `ingredient_id = NULL` while `catalog_match` still says 'resolved' and the
  // stored name is the old canonical one. The next backfill must re-resolve.
  const real = createCanonicaliser({
    index: buildCatalogIndex(catalogBundle.ingredients),
    lookup: createConversionLookup(catalogBundle.ingredients, []),
  });

  it('re-resolves a recipe line to the surviving ingredient and renames it', () => {
    const update = planRecipeIngredientBackfill(
      recipeRow({ name: 'Garlic (Clove)', quantity: 4, unit: 'piece', ingredientId: null, catalogMatch: 'resolved' }),
      real,
    );
    expect(update).toMatchObject({ name: 'Garlic', quantity: 4, unit: 'piece', ingredientId: 'garlic', catalogMatch: 'resolved' });
  });

  it('records the surviving id on a pantry row and keeps the typed qualifier', () => {
    const update = planPantryBackfill(pantryRow({ name: 'Garlic (Clove)', ingredientId: null, catalogMatch: 'resolved' }), real);
    expect(update).toMatchObject({ ingredientId: 'garlic', catalogMatch: 'resolved' });
  });

  it('settles after one pass', () => {
    const first = planRecipeIngredientBackfill(
      recipeRow({ name: 'Roasted Cumin Powder', quantity: 1, unit: 'tsp', ingredientId: null, catalogMatch: 'resolved' }),
      real,
    );
    expect(first).toMatchObject({ name: 'Cumin Powder', ingredientId: 'cumin_powder' });
    expect(planRecipeIngredientBackfill({ ...recipeRow({}), ...first } as RecipeIngredientBackfillRow, real)).toBeNull();
  });
});
