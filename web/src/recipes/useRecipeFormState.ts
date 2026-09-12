'use client';

import { useState } from 'react';
import type { RecipeFormValues } from './types';

export const BLANK_RECIPE_FORM_VALUES: RecipeFormValues = {
  title: '',
  description: '',
  servings: null,
  prepMin: null,
  cookMin: null,
  cuisineTier1: null,
  cuisineTier2: '',
  dietaryTags: [],
  role: null,
  ingredients: [],
  steps: [],
};

/**
 * Holds `RecipeForm`'s editable field state as one object, so the form
 * container, `buildRecipePatch` (edit mode), and `createRecipe`'s `input`
 * (create mode) all read from the identical shape — no second, parallel
 * set of `useState` calls to keep in sync.
 */
export const useRecipeFormState = (initial: RecipeFormValues) => {
  const [values, setValues] = useState<RecipeFormValues>(initial);

  const setField = <K extends keyof RecipeFormValues>(key: K, value: RecipeFormValues[K]): void => {
    setValues((previous) => ({ ...previous, [key]: value }));
  };

  return { values, setField, setValues };
};
