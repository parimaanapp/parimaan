'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from 'urql';
import { buildRecipePatch } from './buildRecipePatch';
import { CREATE_RECIPE_MUTATION, UPDATE_RECIPE_MUTATION } from './recipeMutations';
import type { Recipe, RecipeFormValues, RecipeSourceAttribution } from './types';

interface UseRecipeFormSubmitArgs {
  mode: 'create' | 'edit';
  values: RecipeFormValues;
  householdId?: string | undefined;
  source?: RecipeSourceAttribution | undefined;
  initialRecipe?: Recipe | undefined;
  recipeId?: string | undefined;
}

const toRecipeInput = (values: RecipeFormValues) => ({
  title: values.title,
  description: values.description || null,
  servings: values.servings,
  prepMin: values.prepMin,
  cookMin: values.cookMin,
  cuisineTier1: values.cuisineTier1,
  cuisineTier2: values.cuisineTier2 || null,
  dietaryTags: values.dietaryTags,
  role: values.role,
  ingredients: values.ingredients,
  steps: values.steps,
});

/**
 * Owns `RecipeForm`'s submit logic — which mutation fires, the partial
 * patch for edit mode, the inline error state, and the post-save redirect
 * — pulled out of the component itself so `RecipeForm`'s own render
 * function stays under this codebase's `max-lines-per-function` budget.
 */
export const useRecipeFormSubmit = ({
  mode,
  values,
  householdId,
  source,
  initialRecipe,
  recipeId,
}: UseRecipeFormSubmitArgs) => {
  const router = useRouter();
  const [createRecipeState, createRecipe] = useMutation(CREATE_RECIPE_MUTATION);
  const [updateRecipeState, updateRecipe] = useMutation(UPDATE_RECIPE_MUTATION);
  const [error, setError] = useState<string | null>(null);

  const afterSave = (mutationError: { message: string } | undefined, savedId: string | undefined): void => {
    setError(mutationError?.message ?? null);
    if (!mutationError && savedId) {
      router.push(`/recipes/${savedId}`);
    }
  };

  const submitCreate = async (): Promise<void> => {
    const result = await createRecipe({ householdId, input: toRecipeInput(values), source });
    afterSave(result.error, result.data?.createRecipe?.id);
  };

  const submitEdit = async (): Promise<void> => {
    if (!initialRecipe || !recipeId) {
      return;
    }
    const patch = buildRecipePatch(initialRecipe, values);
    if (Object.keys(patch).length === 0) {
      setError('Change at least one field before saving.');
      return;
    }
    const result = await updateRecipe({ id: recipeId, input: patch });
    afterSave(result.error, recipeId);
  };

  const submit = (): void => {
    setError(null);
    void (mode === 'create' ? submitCreate() : submitEdit());
  };

  return { submit, error, fetching: createRecipeState.fetching || updateRecipeState.fetching };
};
