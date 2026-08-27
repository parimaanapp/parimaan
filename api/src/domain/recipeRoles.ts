/**
 * `RecipeRole` is the meal-slot categorization a recipe fills (breakfast,
 * carb, sabzi_dal, ...) — unrelated to `HouseholdRole` (primary/member),
 * despite the name overlap (E2E_MVP_PLAN.md §12.7 D1, confirmed with the
 * founder). A closed GraphQL enum, matching the DB `CHECK` on
 * `recipes.role` (`1787808112003_recipes.ts`) exactly — reject unknown
 * values rather than pass them through, same reasoning as
 * `cuisineTiers.ts`/`dietaryTags.ts`. `role` is REQUIRED on create with no
 * default (§12.7 D1/D2) — that's the "role assignment required" DoD gate.
 */
export const RECIPE_ROLE_VALUES = [
  'breakfast',
  'carb',
  'sabzi_dal',
  'accompaniment',
  'snack',
  'sweet',
  'drink',
] as const;

export type RecipeRole = (typeof RECIPE_ROLE_VALUES)[number];
