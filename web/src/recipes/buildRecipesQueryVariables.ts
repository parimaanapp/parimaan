import type { RecipeRole } from './types';

/**
 * Builds `RECIPES_QUERY`'s variables — the resolved `householdId` (D3) is
 * always the first, non-optional argument, never taken from anything a
 * client could otherwise influence (RED test 6). `role` is the list
 * screen's one real filter; omitted (not `null`) when the caller has no
 * filter selected, matching `Query.recipes`'s own optional-argument shape.
 */
export const buildRecipesQueryVariables = (
  householdId: string,
  role: RecipeRole | null,
): { householdId: string; role: RecipeRole | undefined } => ({
  householdId,
  role: role ?? undefined,
});

/**
 * Guards the detail screen: throws if a fetched recipe's own `householdId`
 * doesn't match the resolved active household, so a recipe belonging to a
 * different household — which `Query.recipe`'s own RLS should already
 * prevent server-side — is never rendered even if it somehow came back
 * (defence in depth, RED test 6).
 */
export const assertOwnHousehold = (recipe: { householdId: string }, resolvedHouseholdId: string): void => {
  if (recipe.householdId !== resolvedHouseholdId) {
    throw new Error('Recipe does not belong to the active household');
  }
};
