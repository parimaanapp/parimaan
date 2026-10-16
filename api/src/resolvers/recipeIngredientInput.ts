import type { IngredientCanonicaliser } from '../domain/canonicaliseIngredient.js';
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
 * resolves, the typed name kept and flagged when it does not. Category and
 * staple flag are passed through untouched, so staples stay staples.
 */
export const toRecipeIngredientInsert = (
  recipeId: string,
  ingredient: RecipeIngredientSource,
  sortOrder: number,
  canonicaliser: IngredientCanonicaliser,
): InsertRecipeIngredientInput => {
  const line = canonicaliser.recipeLine({
    name: ingredient.name,
    quantity: ingredient.quantity ?? null,
    unit: ingredient.unit ?? null,
    notes: ingredient.notes ?? null,
  });
  return {
    recipeId,
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    category: ingredient.category ?? null,
    notes: line.notes,
    isStaple: ingredient.isStaple ?? false,
    sortOrder,
    ingredientId: line.ingredientId,
    catalogMatch: line.catalogMatch,
  };
};
