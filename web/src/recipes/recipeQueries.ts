import type { Recipe } from './types';

/**
 * W18 S5's read queries — field selections match `Recipe` (`types.ts`) and
 * `shared/schema.graphql`'s own `Recipe` type exactly. `Query.recipes`
 * deliberately does not select `ingredients`/`steps` (the schema's own doc
 * comment: that field resolves via a separate join even the Library screen
 * avoids paying for) — the list view never needs them, only the detail
 * view does via the separate `RECIPE_QUERY`.
 */
export const RECIPES_QUERY = `
  query Recipes($householdId: ID!, $role: RecipeRole) {
    recipes(householdId: $householdId, role: $role) {
      id
      householdId
      title
      role
      cuisineTier1
      dietaryTags
      isFavorite
      inRotation
      servings
      prepMin
      cookMin
    }
  }
`;

export type RecipeListItem = Pick<
  Recipe,
  | 'id'
  | 'householdId'
  | 'title'
  | 'role'
  | 'cuisineTier1'
  | 'dietaryTags'
  | 'isFavorite'
  | 'inRotation'
  | 'servings'
  | 'prepMin'
  | 'cookMin'
>;

export interface RecipesQueryResult {
  recipes: RecipeListItem[];
}

export const RECIPE_QUERY = `
  query RecipeDetail($id: ID!) {
    recipe(id: $id) {
      id
      householdId
      sourceType
      sourceUrl
      title
      description
      servings
      prepMin
      cookMin
      cuisineTier1
      cuisineTier2
      dietaryTags
      role
      inRotation
      isFavorite
      ingredients {
        id
        name
        quantity
        unit
        category
        notes
        isStaple
      }
      steps
      createdAt
      updatedAt
    }
  }
`;

export interface RecipeQueryResult {
  recipe: Recipe;
}
