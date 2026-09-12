import type { RecipeDraft, RecipeFormValues, RecipeIngredientInput } from './types';

/**
 * Seeds `RecipeForm`'s review-mode state from an unsaved `RecipeDraft`
 * (`importRecipeFromUrl`/`parseFreeformRecipe`'s return shape). `role`
 * passes through as `null`, never a guessed default — the draft's own doc
 * comment is explicit that an AI-proposed role does not satisfy "role
 * assignment required," the user must still affirmatively choose it
 * before the confirming `createRecipe` call can succeed.
 */
export const draftToFormValues = (draft: RecipeDraft): RecipeFormValues => ({
  title: draft.title ?? '',
  description: draft.description ?? '',
  servings: draft.servings,
  prepMin: draft.prepMin,
  cookMin: draft.cookMin,
  cuisineTier1: draft.cuisineTier1,
  cuisineTier2: draft.cuisineTier2 ?? '',
  dietaryTags: draft.dietaryTags,
  role: draft.role,
  ingredients: draft.ingredients.map(toIngredientInput),
  steps: draft.steps,
});

const toIngredientInput = (ingredient: RecipeDraft['ingredients'][number]): RecipeIngredientInput => ({
  name: ingredient.name,
  quantity: ingredient.quantity,
  unit: ingredient.unit,
  category: null,
  notes: ingredient.notes,
  isStaple: false,
});
