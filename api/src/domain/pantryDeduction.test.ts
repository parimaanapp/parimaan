import { describe, expect, it } from 'vitest';
import type { DeductionRecipe, PantryItemForDeduction } from './pantryDeduction.js';
import { computeDeductionLines } from './pantryDeduction.js';
import type { RecipeIngredient } from './shoppingListGeneration.js';

const ingredient = (overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
  name: 'onion',
  quantity: 2,
  unit: 'piece',
  category: null,
  isStaple: false,
  ...overrides,
});

const pantryItem = (overrides: Partial<PantryItemForDeduction> = {}): PantryItemForDeduction => ({
  id: 'pantry-1',
  name: 'onion',
  quantity: 5,
  unit: 'piece',
  ...overrides,
});

const recipe = (ingredients: readonly RecipeIngredient[], servings = 4): DeductionRecipe => ({
  servings,
  ingredients,
});

describe('computeDeductionLines', () => {
  it('produces a decrement line at the recipe’s required quantity for an exact name+unit match', () => {
    const result = computeDeductionLines(
      recipe([ingredient({ name: 'onion', quantity: 2, unit: 'piece' })]),
      null,
      [pantryItem({ id: 'p1', name: 'onion', quantity: 5, unit: 'piece' })],
    );

    expect(result).toEqual([{ pantryItemId: 'p1', newQuantity: 3 }]);
  });

  it('converts and decrements correctly for a same-family cross-unit match (recipe grams against pantry kilograms)', () => {
    // 200g needed; pantry holds 1kg = 1000g; 1000 - 200 = 800g, expressed
    // in the pantry row's own unit (kg): 0.8kg.
    const result = computeDeductionLines(
      recipe([ingredient({ name: 'flour', quantity: 200, unit: 'g' })]),
      null,
      [pantryItem({ id: 'p1', name: 'flour', quantity: 1, unit: 'kg' })],
    );

    expect(result).toEqual([{ pantryItemId: 'p1', newQuantity: 0.8 }]);
  });

  it('no-ops (never fabricates a new pantry row) when no pantry row matches the ingredient', () => {
    const result = computeDeductionLines(recipe([ingredient({ name: 'saffron', quantity: 1, unit: 'g' })]), null, [
      pantryItem({ id: 'p1', name: 'onion', quantity: 5, unit: 'piece' }),
    ]);

    expect(result).toEqual([{ pantryItemId: null }]);
  });

  it('no-ops when the name matches but the unit is cross-family/unconvertible, rather than incorrectly decrementing', () => {
    const result = computeDeductionLines(recipe([ingredient({ name: 'onion', quantity: 2, unit: 'g' })]), null, [
      pantryItem({ id: 'p1', name: 'onion', quantity: 5, unit: 'piece' }),
    ]);

    expect(result).toEqual([{ pantryItemId: null }]);
    expect(result[0]).not.toHaveProperty('newQuantity');
  });

  it('does NOT decrement a staple-flagged ingredient even with a real matching pantry row (O2)', () => {
    const result = computeDeductionLines(
      recipe([ingredient({ name: 'salt', quantity: 1, unit: 'g', isStaple: true })]),
      null,
      [pantryItem({ id: 'p1', name: 'salt', quantity: 100, unit: 'g' })],
    );

    expect(result).toEqual([{ pantryItemId: null }]);
  });

  it('does NOT decrement a staple-category ingredient even with a real matching pantry row (O2)', () => {
    const result = computeDeductionLines(
      recipe([ingredient({ name: 'oil', quantity: 1, unit: 'cup', category: 'oil' })]),
      null,
      [pantryItem({ id: 'p1', name: 'oil', quantity: 5, unit: 'cup' })],
    );

    expect(result).toEqual([{ pantryItemId: null }]);
  });

  it('does NOT decrement a staple-unit ingredient even with a real matching pantry row (O2)', () => {
    const result = computeDeductionLines(recipe([ingredient({ name: 'cumin', quantity: 1, unit: 'tsp' })]), null, [
      pantryItem({ id: 'p1', name: 'cumin', quantity: 50, unit: 'g' }),
    ]);

    expect(result).toEqual([{ pantryItemId: null }]);
  });

  it('decrements a non-staple ingredient normally even when it shares a recipe with excluded staples (per-ingredient, not per-recipe)', () => {
    const result = computeDeductionLines(
      recipe([
        ingredient({ name: 'salt', quantity: 1, unit: 'g', isStaple: true }),
        ingredient({ name: 'onion', quantity: 2, unit: 'piece' }),
      ]),
      null,
      [pantryItem({ id: 'p-salt', name: 'salt', quantity: 100, unit: 'g' }), pantryItem({ id: 'p-onion', name: 'onion', quantity: 5, unit: 'piece' })],
    );

    expect(result).toEqual([{ pantryItemId: null }, { pantryItemId: 'p-onion', newQuantity: 3 }]);
  });

  it('scales the recipe’s ingredient quantities by servingsOverride before matching, identical to aggregateIngredients', () => {
    // Recipe serves 4, needs 2 onions; servingsOverride 8 => scale x2 => 4 onions needed.
    const result = computeDeductionLines(
      recipe([ingredient({ name: 'onion', quantity: 2, unit: 'piece' })], 4),
      8,
      [pantryItem({ id: 'p1', name: 'onion', quantity: 10, unit: 'piece' })],
    );

    expect(result).toEqual([{ pantryItemId: 'p1', newQuantity: 6 }]);
  });

  it('clamps a matched row’s post-deduction quantity to exactly 0, never negative (O1)', () => {
    const result = computeDeductionLines(recipe([ingredient({ name: 'onion', quantity: 5, unit: 'piece' })]), null, [
      pantryItem({ id: 'p1', name: 'onion', quantity: 2, unit: 'piece' }),
    ]);

    expect(result).toEqual([{ pantryItemId: 'p1', newQuantity: 0 }]);
  });

  it('clamps a tiny floating-point residual (below the subtraction epsilon) to exactly 0, not a spurious near-zero quantity', () => {
    // Built directly with matching units (same convention
    // `shoppingListGeneration.test.ts` uses) to isolate the epsilon-clamp
    // itself: a "fully covered" line can otherwise leave a positive
    // residual on the order of 1e-10 instead of exactly 0.
    const result = computeDeductionLines(recipe([ingredient({ name: 'ghee', quantity: 5 - 1e-10, unit: 'cup' })]), null, [
      pantryItem({ id: 'p1', name: 'ghee', quantity: 5, unit: 'cup' }),
    ]);

    expect(result).toEqual([{ pantryItemId: 'p1', newQuantity: 0 }]);
    expect(Object.is((result[0] as { newQuantity: number }).newQuantity, -0)).toBe(false);
  });

  it('no-ops when the first matching pantry row (by order) has a null quantity, even if a second matching row has a real one', () => {
    // `findMatchingPantryItem` is "first match wins" (mirrors
    // `shoppingListGeneration.ts`'s own doc'd simplification) — it doesn't
    // fall through to a second matching row just because the first one's
    // quantity is unknown.
    const result = computeDeductionLines(recipe([ingredient({ name: 'onion', quantity: 2, unit: 'piece' })]), null, [
      pantryItem({ id: 'p1', name: 'onion', quantity: null, unit: 'piece' }),
      pantryItem({ id: 'p2', name: 'onion', quantity: 10, unit: 'piece' }),
    ]);

    expect(result).toEqual([{ pantryItemId: null }]);
  });

  it('falls back to an unscaled (x1) quantity when recipe.servings is 0, even with a non-null servingsOverride', () => {
    const result = computeDeductionLines(recipe([ingredient({ name: 'onion', quantity: 2, unit: 'piece' })], 0), 8, [
      pantryItem({ id: 'p1', name: 'onion', quantity: 10, unit: 'piece' }),
    ]);

    expect(result).toEqual([{ pantryItemId: 'p1', newQuantity: 8 }]);
  });
});
