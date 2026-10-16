import type { IngredientCanonicaliser } from '../domain/canonicaliseIngredient.js';
import { isAlwaysStaple } from '../domain/ingredientNormalisation/normaliseIngredient.js';
import type { InsertRecipeIngredientInput } from '../repositories/recipeRepository.js';

/** The caller-supplied ingredient fields shared by `createRecipe`, `updateRecipe` and curated seeding. */
export interface RecipeIngredientSource {
  readonly name: string;
  readonly quantity?: number | null | undefined;
  readonly unit?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly isStaple?: boolean | null | undefined;
}

/**
 * Builds the `recipe_ingredients` insert for one ingredient, resolving its
 * name through the catalog (B2b): canonical name + `ingredient_id` when it
 * resolves, the typed name kept and flagged when it does not. Category is
 * passed through untouched. The staple flag is the client's, except that salt
 * and pepper are ALWAYS stored as staples (founder decision), whatever the
 * client sent, so a stale or hand-edited client cannot un-staple them.
 */
export const toRecipeIngredientFields = (
  ingredient: RecipeIngredientSource,
  sortOrder: number,
  canonicaliser: IngredientCanonicaliser,
): Omit<InsertRecipeIngredientInput, 'recipeId'> => {
  const line = canonicaliser.recipeLine({
    name: ingredient.name,
    quantity: ingredient.quantity ?? null,
    unit: ingredient.unit ?? null,
    notes: ingredient.notes ?? null,
  });
  return {
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    category: ingredient.category ?? null,
    notes: line.notes,
    isStaple: isAlwaysStaple(ingredient.name) || isAlwaysStaple(line.name) || (ingredient.isStaple ?? false),
    sortOrder,
    ingredientId: line.ingredientId,
    catalogMatch: line.catalogMatch,
  };
};

/** `toRecipeIngredientFields` bound to a recipe id, for the per-recipe create/update paths. */
export const toRecipeIngredientInsert = (
  recipeId: string,
  ingredient: RecipeIngredientSource,
  sortOrder: number,
  canonicaliser: IngredientCanonicaliser,
): InsertRecipeIngredientInput => ({ recipeId, ...toRecipeIngredientFields(ingredient, sortOrder, canonicaliser) });
