import type { RecipeIngredientRow, RecipeRow, RecipeSourceType } from '../repositories/recipeRepository.js';

export interface GraphQLRecipe {
  id: string;
  householdId: string;
  sourceType: RecipeSourceType;
  sourceUrl: string | null;
  title: string;
  description: string | null;
  servings: number;
  prepMin: number | null;
  cookMin: number | null;
  cuisineTier1: string | null;
  cuisineTier2: string | null;
  dietaryTags: readonly string[];
  role: string;
  inRotation: boolean;
  isFavorite: boolean;
  steps: readonly string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Maps a `recipes` row to the GraphQL `Recipe` shape. Deliberately omits
 * `ingredients` — that field is resolved separately by
 * `resolvers/recipeIngredients.ts` (E2E_MVP_PLAN.md §12.2.7/D5), the same
 * pattern `mappers/user.ts`'s `toGraphQLUser` uses for `User.households`.
 * Also omits `sourceRawText` and `createdBy` — neither is in the `Recipe`
 * SDL type (no wireframe shows either; `createdBy` is a deliberately small
 * privacy surface, §12.2.8).
 */
export const toGraphQLRecipe = (row: RecipeRow): GraphQLRecipe => ({
  id: row.id,
  householdId: row.householdId,
  sourceType: row.sourceType,
  sourceUrl: row.sourceUrl,
  title: row.title,
  description: row.description,
  servings: row.servings,
  prepMin: row.prepMin,
  cookMin: row.cookMin,
  cuisineTier1: row.cuisineTier1,
  cuisineTier2: row.cuisineTier2,
  dietaryTags: row.dietaryTags,
  role: row.role,
  inRotation: row.inRotation,
  isFavorite: row.isFavorite,
  steps: row.steps,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export interface GraphQLRecipeIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  notes: string | null;
  isStaple: boolean;
}

/** Maps a `recipe_ingredients` row to the GraphQL `RecipeIngredient` shape. `recipeId`/`sortOrder` stay server-internal — neither is in the SDL type. */
export const toGraphQLRecipeIngredient = (row: RecipeIngredientRow): GraphQLRecipeIngredient => ({
  id: row.id,
  name: row.name,
  quantity: row.quantity,
  unit: row.unit,
  category: row.category,
  notes: row.notes,
  isStaple: row.isStaple,
});
