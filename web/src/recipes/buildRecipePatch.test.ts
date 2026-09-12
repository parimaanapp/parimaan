import { describe, expect, it } from 'vitest';
import { buildRecipePatch } from './buildRecipePatch';
import type { Recipe, RecipeFormValues } from './types';

const baseRecipe: Recipe = {
  id: 'r1',
  householdId: 'h1',
  sourceType: 'user',
  sourceUrl: null,
  title: 'Dal',
  description: 'Comfort food',
  servings: 4,
  prepMin: 10,
  cookMin: 20,
  cuisineTier1: 'north_indian',
  cuisineTier2: null,
  dietaryTags: ['veg'],
  role: 'sabzi_dal',
  inRotation: true,
  isFavorite: false,
  ingredients: [
    { id: 'i1', name: 'Toor dal', quantity: 1, unit: 'cup', category: null, notes: null, isStaple: true },
  ],
  steps: ['Rinse dal', 'Pressure cook'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const valuesFromRecipe = (recipe: Recipe): RecipeFormValues => ({
  title: recipe.title,
  description: recipe.description ?? '',
  servings: recipe.servings,
  prepMin: recipe.prepMin,
  cookMin: recipe.cookMin,
  cuisineTier1: recipe.cuisineTier1,
  cuisineTier2: recipe.cuisineTier2 ?? '',
  dietaryTags: recipe.dietaryTags,
  role: recipe.role,
  ingredients: recipe.ingredients.map((ingredient) => ({
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    category: ingredient.category,
    notes: ingredient.notes,
    isStaple: ingredient.isStaple,
  })),
  steps: recipe.steps,
});

describe('buildRecipePatch', () => {
  // RED test 3: an edit submission sends a genuine partial patch — only
  // fields the test actually changed, never the whole object.
  it('omits every field the caller did not change', () => {
    const current = valuesFromRecipe(baseRecipe);
    current.title = 'Dal Tadka';

    const patch = buildRecipePatch(baseRecipe, current);

    expect(patch).toEqual({ title: 'Dal Tadka' });
  });

  it('includes multiple changed scalar fields and nothing else', () => {
    const current = valuesFromRecipe(baseRecipe);
    current.prepMin = 15;
    current.cookMin = 25;

    const patch = buildRecipePatch(baseRecipe, current);

    expect(patch).toEqual({ prepMin: 15, cookMin: 25 });
  });

  it('never sends ingredients/steps when they are unchanged', () => {
    const current = valuesFromRecipe(baseRecipe);
    current.title = 'Dal Tadka';

    const patch = buildRecipePatch(baseRecipe, current);

    expect(patch.ingredients).toBeUndefined();
    expect(patch.steps).toBeUndefined();
  });

  it('includes the whole new ingredients list when ingredients actually changed', () => {
    const current = valuesFromRecipe(baseRecipe);
    current.ingredients = [
      ...current.ingredients,
      { name: 'Turmeric', quantity: 1, unit: 'tsp', category: null, notes: null, isStaple: true },
    ];

    const patch = buildRecipePatch(baseRecipe, current);

    expect(patch).toEqual({ ingredients: current.ingredients });
  });

  it('includes an explicit empty steps list when the caller cleared every step', () => {
    const current = valuesFromRecipe(baseRecipe);
    current.steps = [];

    const patch = buildRecipePatch(baseRecipe, current);

    expect(patch).toEqual({ steps: [] });
  });

  it('returns an empty object when nothing changed at all', () => {
    const current = valuesFromRecipe(baseRecipe);

    const patch = buildRecipePatch(baseRecipe, current);

    expect(patch).toEqual({});
  });

  it('treats an emptied optional text field as a real change (description cleared)', () => {
    const current = valuesFromRecipe(baseRecipe);
    current.description = '';

    const patch = buildRecipePatch(baseRecipe, current);

    expect(patch).toEqual({ description: '' });
  });
});
