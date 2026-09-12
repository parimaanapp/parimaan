'use client';

import type { FormEvent } from 'react';
import { IngredientsEditor } from './IngredientsEditor';
import { RecipeFormFields } from './RecipeFormFields';
import { StepsEditor } from './StepsEditor';
import type { Recipe, RecipeFormValues, RecipeSourceAttribution } from './types';
import { useRecipeFormState } from './useRecipeFormState';
import { useRecipeFormSubmit } from './useRecipeFormSubmit';

interface RecipeFormProps {
  mode: 'create' | 'edit';
  initial: RecipeFormValues;
  /** Required for `mode: 'create'`. */
  householdId?: string;
  /** Required for `mode: 'create'` when confirming a URL-import/freeform-paste draft (never fired automatically — see `NewRecipeEntry`). */
  source?: RecipeSourceAttribution;
  /** Required for `mode: 'edit'` — `buildRecipePatch`'s diff base. */
  initialRecipe?: Recipe;
  /** Required for `mode: 'edit'`. */
  recipeId?: string;
}

/**
 * The one create/edit form for the recipes screen (W18 S5, D5). Create mode
 * wires `createRecipe`; edit mode wires `updateRecipe` with a genuine
 * partial patch via `buildRecipePatch` (RED test 3) — both handled by
 * `useRecipeFormSubmit`. A server error from either mutation renders
 * inline via `role="alert"` (RED test 4) — it never silently swallows a
 * failed save.
 */
export function RecipeForm({ mode, initial, householdId, source, initialRecipe, recipeId }: RecipeFormProps) {
  const { values, setField, setValues } = useRecipeFormState(initial);
  const { submit, error, fetching } = useRecipeFormSubmit({
    mode,
    values,
    householdId,
    source,
    initialRecipe,
    recipeId,
  });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onSubmit}>
      <RecipeFormFields values={values} setField={setField} />
      <IngredientsEditor
        ingredients={values.ingredients}
        onChange={(ingredients) => setValues((prev) => ({ ...prev, ingredients }))}
      />
      <StepsEditor steps={values.steps} onChange={(steps) => setValues((prev) => ({ ...prev, steps }))} />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={fetching}>
        Save
      </button>
    </form>
  );
}
