/**
 * W18 S6's closed-vocabulary constants for the settings admin screen.
 * Mirrors the server's own single sources of truth exactly — never
 * re-derives a second list that could drift:
 *  - `MEAL_TYPES`/`CUISINE_TIER1_OPTIONS`/`DIETARY_TAG_OPTIONS` match
 *    `shared/schema.graphql`'s `MealType`/`CuisineTier1`/`DietaryTag` enums.
 *  - `CUISINE_BIAS_OPTIONS` matches `api/src/validation/
 *    updateHouseholdSettings.ts`'s `CUISINE_TIER2_WEIGHT_VALUES`.
 *  - `SUB_CUISINE_TAXONOMY` mirrors the mobile app's own
 *    `mobile/lib/features/household/domain/cuisine_taxonomy.dart` field
 *    grouping (Tier 1 → Tier 2 sub-cuisines) conceptually, per this slice's
 *    own brief — not ported code, just the same, already-PRD-sourced list
 *    (`docs/PRD.md` §7.3), so the web form doesn't invent a third taxonomy.
 */

export const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snacks: 'Snacks',
  dinner: 'Dinner',
};

export const CUISINE_TIER1_OPTIONS = [
  'north_indian',
  'south_indian',
  'pan_india',
  'indo_chinese',
  'continental',
] as const;
export type CuisineTier1 = (typeof CUISINE_TIER1_OPTIONS)[number];

export const CUISINE_TIER1_LABELS: Record<CuisineTier1, string> = {
  north_indian: 'North Indian',
  south_indian: 'South Indian',
  pan_india: 'Pan-India',
  indo_chinese: 'Indo-Chinese',
  continental: 'Continental',
};

export const DIETARY_TAG_OPTIONS = ['veg', 'vegan', 'jain', 'eggetarian', 'gluten_free', 'dairy_free'] as const;
export type DietaryTag = (typeof DIETARY_TAG_OPTIONS)[number];

export const DIETARY_TAG_LABELS: Record<DietaryTag, string> = {
  veg: 'Vegetarian',
  vegan: 'Vegan',
  jain: 'Jain',
  eggetarian: 'Eggetarian',
  gluten_free: 'Gluten-free',
  dairy_free: 'Dairy-free',
};

export const CUISINE_BIAS_OPTIONS = ['less', 'normal', 'more'] as const;
export type CuisineBias = (typeof CUISINE_BIAS_OPTIONS)[number];

export const CUISINE_BIAS_LABELS: Record<CuisineBias, string> = {
  less: 'Less',
  normal: 'Same',
  more: 'More',
};

export interface SubCuisine {
  key: string;
  label: string;
}

/** `docs/PRD.md` §7.3 — only these two Tier 1 regions have a documented Tier 2. */
export const SUB_CUISINE_TAXONOMY: Partial<Record<CuisineTier1, SubCuisine[]>> = {
  north_indian: [
    { key: 'punjabi', label: 'Punjabi' },
    { key: 'up_bihari', label: 'UP/Bihari' },
    { key: 'rajasthani', label: 'Rajasthani' },
    { key: 'gujarati', label: 'Gujarati' },
    { key: 'marathi', label: 'Marathi' },
  ],
  south_indian: [
    { key: 'tamil', label: 'Tamil' },
    { key: 'kerala_malayali', label: 'Kerala/Malayali' },
    { key: 'andhra_telangana', label: 'Andhra/Telangana' },
    { key: 'karnataka', label: 'Karnataka' },
  ],
};

export const subCuisinesForRegions = (regions: readonly CuisineTier1[]): SubCuisine[] =>
  CUISINE_TIER1_OPTIONS.filter((region) => regions.includes(region)).flatMap(
    (region) => SUB_CUISINE_TAXONOMY[region] ?? [],
  );
