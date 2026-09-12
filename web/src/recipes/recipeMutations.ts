import type { Recipe, RecipeDraft } from './types';

/**
 * W18 S5's write mutations — `createRecipe`/`updateRecipe`/`deleteRecipe`
 * and the two draft-producing mutations (`importRecipeFromUrl`/
 * `parseFreeformRecipe`), all already shipped server-side (D7: no new
 * server surface this week). Field selections on the returned `Recipe`
 * match `RECIPE_QUERY`'s own selection so a mutation result can replace a
 * cached detail view without a second fetch.
 */
const RECIPE_FIELDS = `
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
`;

export const CREATE_RECIPE_MUTATION = `
  mutation CreateRecipe($householdId: ID!, $input: RecipeInput!, $source: RecipeSourceAttribution) {
    createRecipe(householdId: $householdId, input: $input, source: $source) {
      ${RECIPE_FIELDS}
    }
  }
`;

export interface CreateRecipeResult {
  createRecipe: Recipe;
}

export const UPDATE_RECIPE_MUTATION = `
  mutation UpdateRecipe($id: ID!, $input: RecipePatchInput!) {
    updateRecipe(id: $id, input: $input) {
      ${RECIPE_FIELDS}
    }
  }
`;

export interface UpdateRecipeResult {
  updateRecipe: Recipe;
}

export const DELETE_RECIPE_MUTATION = `
  mutation DeleteRecipe($id: ID!) {
    deleteRecipe(id: $id) {
      id
    }
  }
`;

export interface DeleteRecipeResult {
  deleteRecipe: { id: string };
}

const RECIPE_DRAFT_FIELDS = `
  title
  description
  servings
  prepMin
  cookMin
  cuisineTier1
  cuisineTier2
  dietaryTags
  role
  ingredients {
    raw
    name
    quantity
    unit
    notes
  }
  steps
  sourceUrl
  warnings
`;

export const IMPORT_RECIPE_FROM_URL_MUTATION = `
  mutation ImportRecipeFromUrl($url: String!) {
    importRecipeFromUrl(url: $url) {
      ${RECIPE_DRAFT_FIELDS}
    }
  }
`;

export interface ImportRecipeFromUrlResult {
  importRecipeFromUrl: RecipeDraft;
}

export const PARSE_FREEFORM_RECIPE_MUTATION = `
  mutation ParseFreeformRecipe($text: String!) {
    parseFreeformRecipe(text: $text) {
      ${RECIPE_DRAFT_FIELDS}
    }
  }
`;

export interface ParseFreeformRecipeResult {
  parseFreeformRecipe: RecipeDraft;
}
