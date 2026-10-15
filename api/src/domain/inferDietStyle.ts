import { findDietaryViolations } from './cookPreferenceFilter.js';
import { isDietStyle } from './dietMatch.js';

/**
 * H3 — a recipe saved with no style tag would be unreachable by any
 * household that has a style (E2E_MVP_PLAN.md §32.3), so a style is inferred
 * from the title and ingredient names with the same keyword lists the cook
 * filter uses: meat/fish → `non_veg`, egg → `eggetarian`, otherwise `veg`.
 * Explicit tags always win (see `withInferredStyle`).
 */
export const inferDietStyle = (title: string, ingredientNames: readonly string[]): 'veg' | 'eggetarian' | 'non_veg' => {
  const ingredients = ingredientNames.map((name) => ({ name }));
  const clean = (style: 'veg' | 'eggetarian'): boolean =>
    findDietaryViolations({ title, dietaryTags: [style], ingredients }, [style]).length === 0;
  if (clean('veg')) {
    return 'veg';
  }
  return clean('eggetarian') ? 'eggetarian' : 'non_veg';
};

/** Returns `tags` unchanged when it already has a style tag; otherwise `tags` plus the inferred style. */
export const withInferredStyle = (
  tags: readonly string[] | null | undefined,
  title: string,
  ingredientNames: readonly string[],
): string[] => {
  const existing = tags ?? [];
  return existing.some(isDietStyle) ? [...existing] : [...existing, inferDietStyle(title, ingredientNames)];
};
