import { describe, expect, it } from 'vitest';
import { IDENTITY_CANONICALISER } from '../domain/canonicaliseIngredient.js';
import { toRecipeIngredientInsert } from './recipeIngredientInput.js';

const insert = (name: string, isStaple?: boolean | null) =>
  toRecipeIngredientInsert('recipe-1', { name, quantity: 1, unit: 'tsp', isStaple }, 0, IDENTITY_CANONICALISER);

describe('toRecipeIngredientInsert staple handling', () => {
  it.each(['Salt', 'black pepper', 'Sendha Salt', 'Salt and pepper', 'Pepper (ground)'])(
    'stores %s as a staple even when the client sends false, null or nothing',
    (name) => {
      expect(insert(name, false).isStaple).toBe(true);
      expect(insert(name, null).isStaple).toBe(true);
      expect(insert(name).isStaple).toBe(true);
    },
  );

  it.each(['Bell pepper', 'Salted butter', 'Black peppercorns', 'Onion'])('leaves %s to the client flag', (name) => {
    expect(insert(name, false).isStaple).toBe(false);
    expect(insert(name).isStaple).toBe(false);
    expect(insert(name, true).isStaple).toBe(true);
  });
});
