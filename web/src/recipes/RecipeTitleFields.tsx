'use client';

import type { RecipeFormValues } from './types';
import { RECIPE_ROLES } from './types';

interface RecipeTitleFieldsProps {
  values: Pick<RecipeFormValues, 'title' | 'role' | 'description'>;
  setField: <K extends 'title' | 'role' | 'description'>(key: K, value: RecipeFormValues[K]) => void;
}

/** Title, role, and description — the fields every recipe needs regardless of cuisine/timing. */
export function RecipeTitleFields({ values, setField }: RecipeTitleFieldsProps) {
  return (
    <>
      <label>
        Title
        <input
          value={values.title}
          onChange={(e) => setField('title', e.target.value)}
          required
          aria-label="Title"
        />
      </label>
      <label>
        Role
        <select
          value={values.role ?? ''}
          onChange={(e) => setField('role', (e.target.value || null) as RecipeFormValues['role'])}
          required
          aria-label="Role"
        >
          <option value="">Select a role</option>
          {RECIPE_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>
      <label>
        Description
        <textarea
          value={values.description}
          onChange={(e) => setField('description', e.target.value)}
          aria-label="Description"
        />
      </label>
    </>
  );
}
