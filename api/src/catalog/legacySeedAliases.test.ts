import { describe, expect, it } from 'vitest';
import { buildCatalogIndex, resolveIngredient } from '../domain/ingredientCatalog.js';
import { createConversionLookup } from '../domain/ingredientConversion.js';
import { createCanonicaliser } from '../domain/canonicaliseIngredient.js';
import { planRecipeIngredientBackfill } from '../domain/ingredientBackfill.js';
import type { RecipeIngredientBackfillRow } from '../domain/ingredientBackfill.js';
import { catalogBundle } from './bundle.js';

// Names the dev backfill dry-run left unmatched on rows seeded before the
// curated corpus was canonical (decisions.md, "Legacy seed names").
const index = buildCatalogIndex(catalogBundle.ingredients);
const canonicaliser = createCanonicaliser({
  index,
  lookup: createConversionLookup(catalogBundle.ingredients, catalogBundle.conversions),
});

const RESOLVED: ReadonlyArray<readonly [name: string, id: string]> = [
  ['cream', 'cream_fresh'],
  ['lemon juice', 'lemon'],
  ['rajma (kidney beans)', 'rajma_red'],
  ['green chili', 'green_chilli'],
  ['butter', 'butter_salted'],
  ['black peppercorns', 'black_pepper_whole'],
  ['black pepper', 'black_pepper_whole'],
  ['whole wheat flour (aata)', 'atta_whole_wheat_flour'],
  ['kudampuli (gambooge)', 'kudampuli_gambooge'],
  ['poha (flattened rice)', 'poha'],
  ['flattened rice', 'poha'],
  ['pomegranate seeds', 'pomegranate'],
];

// Genuinely generic: no default exists, so the name is kept as typed.
const STAY_UNRESOLVED: readonly string[] = ['oil', 'chicken', 'fish'];

describe('legacy seed names (backfill dry-run backlog)', () => {
  it.each(RESOLVED)('"%s" resolves to %s', (name, id) => {
    expect(resolveIngredient(name, index)).toMatchObject({ status: 'resolved', entry: { id } });
  });

  it.each(STAY_UNRESOLVED)('"%s" is not guessed', (name) => {
    expect(resolveIngredient(name, index)?.status ?? 'unresolved').not.toBe('resolved');
  });

  it('keeps the named variants reachable by their own names', () => {
    expect(resolveIngredient('Poha (Thick)', index)).toMatchObject({ entry: { id: 'poha_thick' } });
    expect(resolveIngredient('Rajma (Chitra)', index)).toMatchObject({ entry: { id: 'rajma_chitra' } });
    expect(resolveIngredient('Butter (Unsalted)', index)).toMatchObject({ entry: { id: 'butter_unsalted' } });
    expect(resolveIngredient('Whipping Cream', index)).toMatchObject({ status: 'ambiguous' });
    expect(resolveIngredient('Kokum', index)).toMatchObject({ entry: { id: 'kokum' } });
    expect(resolveIngredient('Pomegranate Seeds (Dried)', index)).toMatchObject({ entry: { id: 'pomegranate_seeds_dried' } });
  });

  it('makes the generic Poha a plain pantry unit like the other grains', () => {
    const poha = catalogBundle.ingredients.find((e) => e.id === 'poha');
    expect(poha).toMatchObject({ appCategory: 'dry_goods', defaultUnit: 'g', cupG: 85 });
  });
});

const row = (name: string, quantity: number, unit: string): RecipeIngredientBackfillRow => ({
  id: 'r1',
  name,
  quantity,
  unit,
  notes: null,
  ingredientId: null,
  catalogMatch: 'unresolved',
});

describe('backfill planner over the literal unmatched names', () => {
  it.each(RESOLVED)('plans "%s" -> %s', (name, id) => {
    const unit = id === 'lemon' ? 'tbsp' : 'g';
    const update = planRecipeIngredientBackfill(row(name, 2, unit), canonicaliser);
    expect(update).toMatchObject({ ingredientId: id, catalogMatch: 'resolved' });
  });

  it.each(STAY_UNRESOLVED)('plans nothing for already-unresolved "%s"', (name) => {
    expect(planRecipeIngredientBackfill(row(name, 2, 'ml'), canonicaliser)).toBeNull();
  });

  it('turns lemon juice measures into lemon grams, keeping the typed amount', () => {
    expect(planRecipeIngredientBackfill(row('lemon juice', 2, 'tbsp'), canonicaliser)).toMatchObject({
      name: 'Lemon',
      unit: 'g',
      quantity: 40,
      notes: '2 tbsp',
    });
    const ml = planRecipeIngredientBackfill(row('lemon juice', 30, 'ml'), canonicaliser);
    expect(ml).toMatchObject({ name: 'Lemon', unit: 'g' });
    expect(ml?.quantity).toBeCloseTo(40, 1);
    // 40 g is one lemon (piece_g), so the line still merges with "1 piece Lemon".
    expect(catalogBundle.ingredients.find((e) => e.id === 'lemon')?.pieceG).toBe(40);
  });

  it('is idempotent on a second pass', () => {
    const first = planRecipeIngredientBackfill(row('lemon juice', 2, 'tbsp'), canonicaliser);
    expect(first).not.toBeNull();
    expect(planRecipeIngredientBackfill({ ...row('x', 0, 'g'), ...first! }, canonicaliser)).toBeNull();
  });
});
