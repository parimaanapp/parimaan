import { describe, expect, it } from 'vitest';
import { recipeToFormValues } from './recipeToFormValues';
import type { Recipe } from './types';

const recipe: Recipe = {
  id: 'r1',
  householdId: 'h1',
  sourceType: 'user',
  sourceUrl: null,
  title: 'Dal',
  description: null,
  servings: 4,
  prepMin: null,
  cookMin: null,
  cuisineTier1: null,
  cuisineTier2: null,
  dietaryTags: [],
  role: 'sabzi_dal',
  inRotation: false,
  isFavorite: false,
  ingredients: [
    { id: 'i1', name: 'Toor dal', quantity: 1, unit: 'cup', category: null, notes: null, isStaple: true },
  ],
  steps: ['Rinse', 'Cook'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('recipeToFormValues', () => {
  it('normalizes null optional text fields to empty strings for the form', () => {
    const values = recipeToFormValues(recipe);
    expect(values.description).toBe('');
    expect(values.cuisineTier2).toBe('');
  });

  it('maps ingredients to plain RecipeIngredientInput rows, dropping the id', () => {
    const values = recipeToFormValues(recipe);
    expect(values.ingredients).toEqual([
      { name: 'Toor dal', quantity: 1, unit: 'cup', category: null, notes: null, isStaple: true },
    ]);
  });

  it('round-trips through buildRecipePatch as an empty patch when nothing changed', async () => {
    const { buildRecipePatch } = await import('./buildRecipePatch');
    const values = recipeToFormValues(recipe);
    expect(buildRecipePatch(recipe, values)).toEqual({});
  });
});
