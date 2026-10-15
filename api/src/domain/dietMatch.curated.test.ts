import { describe, expect, it } from 'vitest';
import { getCuratedRecipesFromCorpus } from '../curatedRecipes.js';
import { isRecipeEligible } from './dietMatch.js';
import { DEFAULT_MEALS_ENABLED, DEFAULT_MEAL_STRUCTURE } from './householdDefaults.js';
import { defaultRng, enumerateEmptySlots, pickForSlots } from './rotationSelection.js';
import type { WeightedCandidate } from './rotationSelection.js';

/** Beta #10 acceptance (§32.2): a fresh household with the shipped curated set fills >= 90% of empty slots. */
describe('shipped curated recipes vs a fresh household', () => {
  const recipes = getCuratedRecipesFromCorpus().map((recipe, index) => ({ ...recipe, id: `r${index}` }));
  const slots = enumerateEmptySlots(
    { mealsEnabled: DEFAULT_MEALS_ENABLED, mealStructure: DEFAULT_MEAL_STRUCTURE as unknown as Record<string, unknown> },
    [],
  );

  const fillRatio = (householdTags: readonly string[]): number => {
    const byRole = new Map<string, WeightedCandidate[]>();
    for (const recipe of recipes) {
      if (!isRecipeEligible(recipe.dietaryTags ?? [], householdTags)) continue;
      const pool = byRole.get(recipe.role) ?? [];
      pool.push({ recipeId: recipe.id, weight: 1 });
      byRole.set(recipe.role, pool);
    }
    // Nothing is in rotation yet for a fresh household: everything is fallback.
    return pickForSlots(slots, new Map(), defaultRng, byRole).length / slots.length;
  };

  it('fills at least 90% of slots for the default [veg, eggetarian] household', () => {
    expect(fillRatio(['veg', 'eggetarian'])).toBeGreaterThanOrEqual(0.9);
  });

  it('fills something for a veg-only household', () => {
    expect(fillRatio(['veg'])).toBeGreaterThan(0);
  });
});
