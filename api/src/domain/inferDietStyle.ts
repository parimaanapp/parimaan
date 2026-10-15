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

const MEAT_FREE_STYLES: readonly string[] = ['veg', 'vegan', 'jain'];

/**
 * F4: tags a MODEL proposed for a draft are untrusted, so they never
 * override the ingredient evidence. With meat or fish present every other
 * style is dropped in favour of `non_veg`; with egg (and no meat) the
 * veg/vegan/jain tags are dropped in favour of `eggetarian`; with neither,
 * a stray `non_veg` that contradicts a veg-ish tag is dropped. A draft with
 * no style at all gets the inferred one. Never emits `non_veg` together
 * with veg/vegan/jain.
 */
export const reconcileDraftStyle = (
  tags: readonly string[],
  title: string,
  ingredientNames: readonly string[],
): string[] => {
  const evidence = inferDietStyle(title, ingredientNames);
  const hasMeatFreeTag = tags.some((tag) => MEAT_FREE_STYLES.includes(tag));
  const keep = (tag: string): boolean => {
    if (!isDietStyle(tag)) {
      return true;
    }
    if (evidence === 'non_veg') {
      return false;
    }
    if (evidence === 'eggetarian') {
      return !MEAT_FREE_STYLES.includes(tag);
    }
    return tag !== 'non_veg' || !hasMeatFreeTag;
  };
  const kept = tags.filter(keep);
  return kept.some(isDietStyle) ? kept : [...kept, evidence];
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
