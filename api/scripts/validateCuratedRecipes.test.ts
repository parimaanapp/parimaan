import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  repoRecipesDir,
  validateAllCuratedRecipes,
  validateCuratedRecipe,
} from './validateCuratedRecipes.js';

/** A minimal, well-formed `recipes/north-indian/<slug>.json` fixture. */
const validRecipe = {
  title: 'Dal Tadka',
  description: 'A simple everyday yellow lentil dal, tempered with ghee and cumin.',
  servings: 4,
  prepMin: 10,
  cookMin: 25,
  cuisineTier1: 'north_indian',
  dietaryTags: ['veg', 'gluten_free'],
  role: 'sabzi_dal',
  ingredients: [{ name: 'toor dal', quantity: 1, unit: 'cup', category: 'pantry', isStaple: true }],
  steps: ['Rinse and pressure-cook the dal until soft.', 'Temper with ghee, cumin, and garlic; mix in.'],
};

const northIndianPath = join('recipes', 'north-indian', 'dal-tadka.json');

describe('validateCuratedRecipe', () => {
  it('accepts a minimal, well-formed fixture file', () => {
    const result = validateCuratedRecipe(northIndianPath, validRecipe);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each(['title', 'role', 'ingredients', 'steps'] as const)(
    'rejects a file missing the required field %s',
    (field) => {
      const { [field]: _omitted, ...withoutField } = validRecipe;
      void _omitted;
      const result = validateCuratedRecipe(northIndianPath, withoutField);
      expect(result.success).toBe(false);
    },
  );

  it('rejects an unrecognised role value', () => {
    const result = validateCuratedRecipe(northIndianPath, { ...validRecipe, role: 'dessert' });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised cuisineTier1 value', () => {
    const result = validateCuratedRecipe(northIndianPath, { ...validRecipe, cuisineTier1: 'italian' });
    expect(result.success).toBe(false);
  });

  it('rejects a cuisineTier1 other than "north_indian" for a file under recipes/north-indian/', () => {
    const result = validateCuratedRecipe(northIndianPath, { ...validRecipe, cuisineTier1: 'south_indian' });
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('north_indian');
  });

  it('accepts a non-"north_indian" cuisineTier1 for a file outside recipes/north-indian/', () => {
    const otherPath = join('recipes', 'south-indian', 'sambar.json');
    const result = validateCuratedRecipe(otherPath, { ...validRecipe, cuisineTier1: 'south_indian' });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognised dietaryTags entry', () => {
    const result = validateCuratedRecipe(northIndianPath, { ...validRecipe, dietaryTags: ['keto'] });
    expect(result.success).toBe(false);
  });

  it('rejects an empty ingredients array', () => {
    const result = validateCuratedRecipe(northIndianPath, { ...validRecipe, ingredients: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an empty steps array', () => {
    const result = validateCuratedRecipe(northIndianPath, { ...validRecipe, steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an ingredient with an empty name', () => {
    const result = validateCuratedRecipe(northIndianPath, {
      ...validRecipe,
      ingredients: [{ name: '   ' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a blank step string', () => {
    const result = validateCuratedRecipe(northIndianPath, {
      ...validRecipe,
      steps: ['Rinse the dal.', '   '],
    });
    expect(result.success).toBe(false);
  });
});

describe('validateAllCuratedRecipes — full corpus', () => {
  // §21.3 S1's own RED test: the full-corpus test globs the real
  // `recipes/**/*.json` on disk and must pass vacuously with zero real
  // files present today (only `recipes/north-indian/.gitkeep` exists) —
  // green today, and only turns red later if a malformed file is ever
  // added, never red for having zero recipes yet.
  it('passes vacuously against the real recipes/ directory on disk', () => {
    const results = validateAllCuratedRecipes(repoRecipesDir());
    const failures = results.filter((result) => !result.success);
    expect(failures).toEqual([]);
  });
});
