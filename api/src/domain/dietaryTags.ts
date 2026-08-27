/**
 * `DietaryTag` is a closed GraphQL enum (`shared/schema.graphql`) — see
 * `cuisineTiers.ts`'s identical reasoning for why this rejects unknown
 * values rather than passing them through like `pantryUnits.ts`/
 * `pantryCategories.ts`. Single source of truth for both
 * `household_settings.dietary_tags` (`validation/updateHouseholdSettings.ts`)
 * and `recipes.dietary_tags` (`validation/recipes.ts`).
 */
export const DIETARY_TAG_VALUES = [
  'veg',
  'vegan',
  'jain',
  'eggetarian',
  'gluten_free',
  'dairy_free',
] as const;

export type DietaryTag = (typeof DIETARY_TAG_VALUES)[number];
