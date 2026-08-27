/**
 * `CuisineTier1` is a closed GraphQL enum (`shared/schema.graphql`), unlike
 * `pantryUnits.ts`/`pantryCategories.ts`'s open, pass-through free text
 * (E2E_MVP_PLAN.md §11.2.4). An unrecognised value here isn't just an
 * unnormalised field — it's a value AppSync cannot serialize at all, which
 * fails the *entire* response the field appears in (§12.2.6). This is the
 * single source of truth for the value list: both `household_settings`
 * (`validation/updateHouseholdSettings.ts`) and `recipes`
 * (`validation/recipes.ts`) validate against this same array, so the two
 * can never silently drift out of sync the way the `recipes` migration's
 * own `CHECK` constraint once did (see
 * `1787811731724_fix-recipes-cuisine-tier1-check.ts`).
 */
export const CUISINE_TIER1_VALUES = [
  'north_indian',
  'south_indian',
  'pan_india',
  'indo_chinese',
  'continental',
] as const;

export type CuisineTier1 = (typeof CUISINE_TIER1_VALUES)[number];
