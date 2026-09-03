import { describe, expect, it } from 'vitest';
import type { AggregatedIngredient, AggregationMenuItem, AggregationRecipe, PantryItemForSubtraction, RecipeIngredient } from './shoppingListGeneration.js';
import { INGREDIENT_SIMILARITY_THRESHOLD, aggregateIngredients, categorize, isStapleExcluded, subtractPantry } from './shoppingListGeneration.js';

const ingredient = (overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
  name: 'onion',
  quantity: 2,
  unit: 'piece',
  category: null,
  isStaple: false,
  ...overrides,
});

describe('isStapleExcluded', () => {
  it.each(['tsp', 'tbsp', 'pinch', 'to_taste'])('excludes a %s-unit ingredient regardless of is_staple', (unit) => {
    expect(isStapleExcluded(ingredient({ unit, isStaple: false }))).toBe(true);
  });

  it('excludes an is_staple=true ingredient regardless of unit', () => {
    expect(isStapleExcluded(ingredient({ unit: 'kg', isStaple: true }))).toBe(true);
  });

  it.each(['spice', 'masala', 'salt', 'oil'])('excludes a category=%s ingredient regardless of the other two', (category) => {
    expect(isStapleExcluded(ingredient({ category, unit: 'kg', isStaple: false }))).toBe(true);
  });

  it('does not exclude an ingredient satisfying none of the three exclusions', () => {
    expect(isStapleExcluded(ingredient({ unit: 'piece', category: 'produce', isStaple: false }))).toBe(false);
  });

  it('matches unit/category case-insensitively and trims whitespace', () => {
    expect(isStapleExcluded(ingredient({ unit: ' TSP ', isStaple: false }))).toBe(true);
    expect(isStapleExcluded(ingredient({ category: ' Salt ', unit: 'kg' }))).toBe(true);
  });
});

const recipe = (id: string, ingredients: readonly RecipeIngredient[], servings = 4): AggregationRecipe => ({
  id,
  servings,
  ingredients,
});

const menuItem = (overrides: Partial<AggregationMenuItem> = {}): AggregationMenuItem => ({
  dayOfWeek: 0,
  mealSlot: 'lunch',
  recipeId: 'recipe-1',
  servingsOverride: null,
  ...overrides,
});

describe('aggregateIngredients', () => {
  it('sums two menu items using recipes that share an identically-spelled ingredient in the same unit', () => {
    const recipesById = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 2, unit: 'piece' })])],
      ['r2', recipe('r2', [ingredient({ name: 'onion', quantity: 3, unit: 'piece' })])],
    ]);
    const items = [menuItem({ recipeId: 'r1' }), menuItem({ recipeId: 'r2', dayOfWeek: 1 })];

    const result = aggregateIngredients(items, recipesById);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('onion');
    expect(result[0]!.quantity).toBe(5);
    expect(result[0]!.unit).toBe('piece');
  });

  it('never falsely merges two clearly-different but superficially similar ingredients ("onion" vs "onion powder")', () => {
    const recipesById = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 2, unit: 'piece' })])],
      ['r2', recipe('r2', [ingredient({ name: 'onion powder', quantity: 10, unit: 'g', category: null })])],
    ]);
    const items = [menuItem({ recipeId: 'r1' }), menuItem({ recipeId: 'r2' })];

    const result = aggregateIngredients(items, recipesById);

    expect(result.map((r) => r.name).sort()).toEqual(['onion', 'onion powder']);
  });

  it('merges a same-ingredient pair with a small spelling/pluralization difference ("onion" vs "onions")', () => {
    const recipesById = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 2, unit: 'piece' })])],
      ['r2', recipe('r2', [ingredient({ name: 'onions', quantity: 3, unit: 'piece' })])],
    ]);
    const items = [menuItem({ recipeId: 'r1' }), menuItem({ recipeId: 'r2' })];

    const result = aggregateIngredients(items, recipesById);

    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(5);
  });

  it('INGREDIENT_SIMILARITY_THRESHOLD is a named, exported constant, and a pair straddling it flips the merge outcome', () => {
    expect(INGREDIENT_SIMILARITY_THRESHOLD).toBe(0.75);

    // "onion" vs "onion powder": Dice ~0.53 — below threshold, never merges.
    const belowThreshold = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 1, unit: 'piece' })])],
      ['r2', recipe('r2', [ingredient({ name: 'onion powder', quantity: 1, unit: 'piece' })])],
    ]);
    expect(aggregateIngredients([menuItem({ recipeId: 'r1' }), menuItem({ recipeId: 'r2' })], belowThreshold)).toHaveLength(2);

    // "onion" vs "onions": Dice ~0.89 — above threshold, merges.
    const aboveThreshold = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 1, unit: 'piece' })])],
      ['r2', recipe('r2', [ingredient({ name: 'onions', quantity: 1, unit: 'piece' })])],
    ]);
    expect(aggregateIngredients([menuItem({ recipeId: 'r1' }), menuItem({ recipeId: 'r2' })], aboveThreshold)).toHaveLength(1);
  });

  it('excludes staple ingredients from the aggregated list', () => {
    const recipesById = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'salt', quantity: 1, unit: 'tsp' }), ingredient({ name: 'onion', quantity: 2, unit: 'piece' })])],
    ]);
    const result = aggregateIngredients([menuItem({ recipeId: 'r1' })], recipesById);

    expect(result.map((r) => r.name)).toEqual(['onion']);
  });

  it('a recipe contributing zero non-staple ingredients contributes nothing to the list', () => {
    const recipesById = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'salt', quantity: 1, unit: 'tsp' }), ingredient({ name: 'oil', quantity: 1, unit: 'cup', category: 'oil' })])],
    ]);
    const result = aggregateIngredients([menuItem({ recipeId: 'r1' })], recipesById);

    expect(result).toHaveLength(0);
  });

  it('scales ingredient quantities by servings_override before aggregation', () => {
    const recipesById = new Map([['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 2, unit: 'piece' })], 4)]]);
    const result = aggregateIngredients([menuItem({ recipeId: 'r1', servingsOverride: 8 })], recipesById);

    expect(result[0]!.quantity).toBe(4);
  });

  it('does not merge across an unconvertible unit boundary even when names match exactly', () => {
    const recipesById = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'paneer', quantity: 200, unit: 'g' })])],
      ['r2', recipe('r2', [ingredient({ name: 'paneer', quantity: 1, unit: 'piece' })])],
    ]);
    const result = aggregateIngredients([menuItem({ recipeId: 'r1' }), menuItem({ recipeId: 'r2' })], recipesById);

    expect(result).toHaveLength(2);
  });

  it('merges same-name ingredients across a same-family convertible unit boundary', () => {
    const recipesById = new Map([
      ['r1', recipe('r1', [ingredient({ name: 'milk', quantity: 500, unit: 'ml' })])],
      ['r2', recipe('r2', [ingredient({ name: 'milk', quantity: 1, unit: 'l' })])],
    ]);
    const result = aggregateIngredients([menuItem({ recipeId: 'r1' }), menuItem({ recipeId: 'r2' })], recipesById);

    expect(result).toHaveLength(1);
    expect(result[0]!.unit).toBe('ml');
    expect(result[0]!.quantity).toBe(1500);
  });
});

describe('subtractPantry', () => {
  const pantryItem = (overrides: Partial<PantryItemForSubtraction> = {}): PantryItemForSubtraction => ({
    name: 'onion',
    quantity: 2,
    unit: 'piece',
    ...overrides,
  });

  it('drops a line fully covered by a matching pantry item, never shown as zero', () => {
    const aggregated = aggregateIngredients(
      [menuItem({ recipeId: 'r1' })],
      new Map([['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 2, unit: 'piece' })])]]),
    );
    const result = subtractPantry(aggregated, [pantryItem({ quantity: 5 })]);
    expect(result).toHaveLength(0);
  });

  it('partially reduces a partially-covered line', () => {
    const aggregated = aggregateIngredients(
      [menuItem({ recipeId: 'r1' })],
      new Map([['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 5, unit: 'piece' })])]]),
    );
    const result = subtractPantry(aggregated, [pantryItem({ quantity: 2 })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(3);
  });

  it('converts a same-family cross-unit pantry match correctly (pantry tbsp against a recipe tsp requirement)', () => {
    // Built directly rather than via `aggregateIngredients`: `tsp`/`tbsp`
    // are themselves staple-excluded units (PRD §9), so this exercises
    // `subtractPantry`'s own unit-conversion logic in isolation, the same
    // way it would run against any other same-family pair.
    const aggregated: AggregatedIngredient[] = [
      { name: 'ghee', quantity: 9, unit: 'tsp', category: null, sourceRecipeId: 'r1' },
    ];
    // 2 tbsp pantry stock = 6 tsp, leaving 3 tsp still needed.
    const result = subtractPantry(aggregated, [pantryItem({ name: 'ghee', quantity: 2, unit: 'tbsp' })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBeCloseTo(3, 3);
    expect(result[0]!.unit).toBe('tsp');
  });

  it('clamps a tiny floating-point residual (below the subtraction epsilon) to fully covered, not a spurious near-zero "buy" amount', () => {
    // A same-family cross-unit conversion divides by a decimal
    // approximation, so a genuinely-covered line can leave a residual on
    // the order of 1e-10/1e-12 rather than exactly 0 — built directly here
    // (same unit, no conversion needed) to isolate the epsilon-clamp
    // itself from any particular conversion's rounding behavior.
    const aggregated: AggregatedIngredient[] = [
      { name: 'ghee', quantity: 5 + 1e-10, unit: 'tsp', category: null, sourceRecipeId: 'r1' },
    ];
    const result = subtractPantry(aggregated, [pantryItem({ name: 'ghee', quantity: 5, unit: 'tsp' })]);
    expect(result).toHaveLength(0);
  });

  it('converts a kg pantry row subtracting a g-denominated requirement', () => {
    const aggregated = aggregateIngredients(
      [menuItem({ recipeId: 'r1' })],
      new Map([['r1', recipe('r1', [ingredient({ name: 'atta', quantity: 1500, unit: 'g' })])]]),
    );
    const result = subtractPantry(aggregated, [pantryItem({ name: 'atta', quantity: 1, unit: 'kg' })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(500);
  });

  it('leaves a cross-family-mismatched pantry item at full recipe-required quantity', () => {
    const aggregated = aggregateIngredients(
      [menuItem({ recipeId: 'r1' })],
      new Map([['r1', recipe('r1', [ingredient({ name: 'paneer', quantity: 2, unit: 'cup' })])]]),
    );
    const result = subtractPantry(aggregated, [pantryItem({ name: 'paneer', quantity: 500, unit: 'g' })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(2);
  });

  it('leaves an absent pantry item at full recipe-required quantity', () => {
    const aggregated = aggregateIngredients(
      [menuItem({ recipeId: 'r1' })],
      new Map([['r1', recipe('r1', [ingredient({ name: 'ginger', quantity: 1, unit: 'piece' })])]]),
    );
    const result = subtractPantry(aggregated, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(1);
  });

  it('clamps a zero-or-negative post-subtraction result to zero and drops the line, never shown as "buy -2"', () => {
    const aggregated = aggregateIngredients(
      [menuItem({ recipeId: 'r1' })],
      new Map([['r1', recipe('r1', [ingredient({ name: 'onion', quantity: 2, unit: 'piece' })])]]),
    );
    const result = subtractPantry(aggregated, [pantryItem({ quantity: 10 })]);
    expect(result).toHaveLength(0);
  });
});

describe('categorize', () => {
  it('groups items by category', () => {
    const recipesById = new Map([
      [
        'r1',
        recipe('r1', [
          ingredient({ name: 'onion', quantity: 2, unit: 'piece', category: 'produce' }),
          ingredient({ name: 'paneer', quantity: 200, unit: 'g', category: 'dairy' }),
          ingredient({ name: 'tomato', quantity: 3, unit: 'piece', category: 'produce' }),
        ]),
      ],
    ]);
    const aggregated = aggregateIngredients([menuItem({ recipeId: 'r1' })], recipesById);
    const grouped = categorize(aggregated);

    const produce = grouped.find((g) => g.category === 'produce');
    const dairy = grouped.find((g) => g.category === 'dairy');
    expect(produce?.items.map((i) => i.name).sort()).toEqual(['onion', 'tomato']);
    expect(dairy?.items.map((i) => i.name)).toEqual(['paneer']);
  });

  it('groups an ingredient with no category under "other"', () => {
    const recipesById = new Map([['r1', recipe('r1', [ingredient({ name: 'mystery', quantity: 1, unit: 'piece', category: null })])]]);
    const aggregated = aggregateIngredients([menuItem({ recipeId: 'r1' })], recipesById);
    const grouped = categorize(aggregated);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.category).toBe('other');
  });
});
