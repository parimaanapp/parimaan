/**
 * Dietary matching — the single source of truth for "may this household be
 * served this recipe?" (E2E_MVP_PLAN.md §32.3, founder-approved refinement).
 *
 * Tags split into two groups:
 *  - STYLES    (veg, non_veg, vegan, eggetarian, jain): how the household eats.
 *  - MODIFIERS (gluten_free, dairy_free): always applied, never optional.
 *
 * A recipe is eligible iff
 *   (household has no styles OR recipe tags intersect the union of
 *    `expandStyle(style)` over the household's styles)
 *   AND (every household modifier is among the recipe's tags).
 *
 * Styles combine as a UNION. A style also admits the recipes that are
 * stricter than it: a non-veg household eats veg dishes too (otherwise it
 * would get no breakfasts), an egg-friendly household eats veg dishes, and
 * a veg household accepts vegan and jain dishes. Recipes may additionally
 * carry several tags explicitly.
 *
 * This refines §32.3, which said "no hierarchy logic in code": the
 * expansion table below IS the hierarchy, kept in this one module so the
 * SQL candidate query, the commit-time re-check and the keyword filter all
 * share it.
 */

export const DIET_STYLES = ['veg', 'non_veg', 'vegan', 'eggetarian', 'jain'] as const;
export const DIET_MODIFIERS = ['gluten_free', 'dairy_free'] as const;

export type DietStyle = (typeof DIET_STYLES)[number];
export type DietModifier = (typeof DIET_MODIFIERS)[number];

const STYLE_EXPANSION: Readonly<Record<DietStyle, readonly DietStyle[]>> = {
  veg: ['veg', 'vegan', 'jain'],
  vegan: ['vegan'],
  jain: ['jain'],
  eggetarian: ['eggetarian', 'veg', 'vegan', 'jain'],
  non_veg: ['non_veg', 'eggetarian', 'veg', 'vegan', 'jain'],
};

export const isDietStyle = (tag: string): tag is DietStyle => (DIET_STYLES as readonly string[]).includes(tag);
export const isDietModifier = (tag: string): tag is DietModifier => (DIET_MODIFIERS as readonly string[]).includes(tag);

/** Recipe style tags a household style accepts. */
export const expandStyle = (style: DietStyle): readonly DietStyle[] => STYLE_EXPANSION[style];

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/** The household's style tags, deduplicated; unknown values are ignored. */
export const householdStyles = (householdTags: readonly string[]): DietStyle[] =>
  unique(householdTags.filter(isDietStyle));

/** The household's modifier tags, deduplicated; unknown values are ignored. */
export const householdModifiers = (householdTags: readonly string[]): DietModifier[] =>
  unique(householdTags.filter(isDietModifier));

/** Union of `expandStyle` over the household's styles; empty when it has none. */
export const eligibleRecipeStyleTags = (householdTags: readonly string[]): DietStyle[] =>
  unique(householdStyles(householdTags).flatMap((style) => expandStyle(style)));

/**
 * F1: a household needs an eating style, but shipped clients may send an
 * empty or modifiers-only `dietaryTags`. Rather than reject, a patch without
 * a style keeps the STORED styles and applies only the incoming modifiers;
 * with no stored style either the patch is accepted as sent (a legacy
 * style-less household is unrestricted at read time).
 */
export const reconcileHouseholdTags = (incoming: readonly string[], stored: readonly string[]): string[] => {
  if (incoming.some(isDietStyle)) {
    return [...incoming];
  }
  const storedStyles = stored.filter(isDietStyle);
  if (storedStyles.length === 0) {
    return [...incoming];
  }
  return [...storedStyles, ...incoming];
};

/**
 * `non_veg` is the broadest style and already expands to veg dishes at match
 * time, so a recipe carrying it together with veg/vegan/jain is
 * contradictory (a dish cannot be both). Rejected on write (M2).
 */
export const NON_VEG_CONFLICT_MESSAGE = 'dietaryTags: non_veg cannot be combined with veg, vegan or jain';

export const hasNonVegConflict = (tags: readonly string[]): boolean =>
  tags.includes('non_veg') && ['veg', 'vegan', 'jain'].some((tag) => tags.includes(tag));

/**
 * A vegan recipe contains no dairy, so it also satisfies the `dairy_free`
 * modifier without carrying the tag. Mirrored in the SQL candidate query
 * (`menuRepository.findAutoFillCandidates`), `cookPreferenceFilter` and the
 * Dart port (`diet_match.dart`); all are pinned by
 * `shared/fixtures/dietMatch-cases.json`.
 */
export const effectiveRecipeTags = (recipeTags: readonly string[]): string[] =>
  recipeTags.includes('vegan') && !recipeTags.includes('dairy_free') ? [...recipeTags, 'dairy_free'] : [...recipeTags];

export const isRecipeEligible = (recipeTags: readonly string[], householdTags: readonly string[]): boolean => {
  const tags = effectiveRecipeTags(recipeTags);
  const styles = householdStyles(householdTags);
  const styleOk = styles.length === 0 || eligibleRecipeStyleTags(householdTags).some((tag) => tags.includes(tag));
  return styleOk && householdModifiers(householdTags).every((modifier) => tags.includes(modifier));
};
