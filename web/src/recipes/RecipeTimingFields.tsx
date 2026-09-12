'use client';

import type { RecipeFormValues } from './types';
import { CUISINE_TIER1_VALUES } from './types';

interface RecipeTimingFieldsProps {
  values: Pick<RecipeFormValues, 'servings' | 'prepMin' | 'cookMin' | 'cuisineTier1'>;
  setField: <K extends 'servings' | 'prepMin' | 'cookMin' | 'cuisineTier1'>(
    key: K,
    value: RecipeFormValues[K],
  ) => void;
}

const numberOrNull = (raw: string): number | null => (raw === '' ? null : Number(raw));

/** Servings/timing/cuisine — grouped separately from `RecipeTitleFields` so neither function grows past the `max-lines-per-function` budget. */
export function RecipeTimingFields({ values, setField }: RecipeTimingFieldsProps) {
  return (
    <>
      <label>
        Servings
        <input
          type="number"
          value={values.servings ?? ''}
          onChange={(e) => setField('servings', numberOrNull(e.target.value))}
          aria-label="Servings"
        />
      </label>
      <label>
        Prep minutes
        <input
          type="number"
          value={values.prepMin ?? ''}
          onChange={(e) => setField('prepMin', numberOrNull(e.target.value))}
          aria-label="Prep minutes"
        />
      </label>
      <label>
        Cook minutes
        <input
          type="number"
          value={values.cookMin ?? ''}
          onChange={(e) => setField('cookMin', numberOrNull(e.target.value))}
          aria-label="Cook minutes"
        />
      </label>
      <label>
        Cuisine
        <select
          value={values.cuisineTier1 ?? ''}
          onChange={(e) =>
            setField('cuisineTier1', (e.target.value || null) as RecipeFormValues['cuisineTier1'])
          }
          aria-label="Cuisine"
        >
          <option value="">Unspecified</option>
          {CUISINE_TIER1_VALUES.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
