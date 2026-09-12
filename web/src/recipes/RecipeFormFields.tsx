'use client';

import { DietaryTagsFieldset } from './DietaryTagsFieldset';
import { RecipeTimingFields } from './RecipeTimingFields';
import { RecipeTitleFields } from './RecipeTitleFields';
import type { RecipeFormValues } from './types';

interface RecipeFormFieldsProps {
  values: RecipeFormValues;
  setField: <K extends keyof RecipeFormValues>(key: K, value: RecipeFormValues[K]) => void;
}

/**
 * The scalar/enum half of `RecipeForm` — composes the smaller
 * `RecipeTitleFields`/`RecipeTimingFields`/`DietaryTagsFieldset` pieces
 * rather than rendering every input inline, so no single component here
 * exceeds this codebase's own `max-lines-per-function` budget.
 */
export function RecipeFormFields({ values, setField }: RecipeFormFieldsProps) {
  return (
    <fieldset>
      <legend>Recipe details</legend>
      <RecipeTitleFields values={values} setField={setField} />
      <RecipeTimingFields values={values} setField={setField} />
      <DietaryTagsFieldset selected={values.dietaryTags} onChange={(dietaryTags) => setField('dietaryTags', dietaryTags)} />
    </fieldset>
  );
}
