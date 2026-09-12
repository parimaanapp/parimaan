import { describe, expect, it } from 'vitest';
import { draftToFormValues } from './draftToFormValues';
import type { RecipeDraft } from './types';

const draft: RecipeDraft = {
  title: 'Parsed Dal',
  description: null,
  servings: 4,
  prepMin: 10,
  cookMin: 20,
  cuisineTier1: 'north_indian',
  cuisineTier2: null,
  dietaryTags: ['veg'],
  role: null,
  ingredients: [{ raw: '2 cups atta, sifted', name: 'atta', quantity: 2, unit: 'cup', notes: 'sifted' }],
  steps: ['Mix', 'Cook'],
  sourceUrl: 'https://example.com/recipe',
  warnings: ['could not determine cook time precisely'],
};

describe('draftToFormValues', () => {
  // RED test 2 support: the draft's own nullable `role` never satisfies
  // "role assignment required" — it must come through as null so the
  // review form still demands an affirmative choice, not a pre-filled one
  // that looks confirmed but isn't.
  it('carries the draft role through as null when the AI did not propose one', () => {
    const values = draftToFormValues(draft);
    expect(values.role).toBeNull();
  });

  it('maps every other scalar field straight across', () => {
    const values = draftToFormValues(draft);
    expect(values.title).toBe('Parsed Dal');
    expect(values.servings).toBe(4);
    expect(values.cuisineTier1).toBe('north_indian');
    expect(values.dietaryTags).toEqual(['veg']);
  });

  it('maps draft ingredients to editable RecipeIngredientInput rows, dropping the raw/notes-only AI scaffolding', () => {
    const values = draftToFormValues(draft);
    expect(values.ingredients).toEqual([
      { name: 'atta', quantity: 2, unit: 'cup', category: null, notes: 'sifted', isStaple: false },
    ]);
  });

  it('defaults a null title/description to an empty string, never "null" text', () => {
    const values = draftToFormValues({ ...draft, title: null, description: null });
    expect(values.title).toBe('');
    expect(values.description).toBe('');
  });
});
