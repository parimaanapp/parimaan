import type { Recipe, RecipeFormValues } from './types';

/** Seeds `RecipeForm`'s edit-mode state from an already-loaded `Recipe` — the counterpart to `draftToFormValues` for the create-from-draft path. */
export const recipeToFormValues = (recipe: Recipe): RecipeFormValues => ({
  title: recipe.title,
  description: recipe.description ?? '',
  servings: recipe.servings,
  prepMin: recipe.prepMin,
  cookMin: recipe.cookMin,
  cuisineTier1: recipe.cuisineTier1,
  cuisineTier2: recipe.cuisineTier2 ?? '',
  dietaryTags: recipe.dietaryTags,
  role: recipe.role,
  ingredients: recipe.ingredients.map((ingredient) => ({
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    category: ingredient.category,
    notes: ingredient.notes,
    isStaple: ingredient.isStaple,
  })),
  steps: recipe.steps,
});
