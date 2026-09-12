// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MealStructureSection } from './MealStructureSection';
import { renderWithUrql } from './testUtils';

const initialMealStructure = JSON.stringify({
  breakfast: { carb: 1, sabzi_dal: 1, accompaniment: 0 },
});

// `@testing-library/react` only auto-registers `afterEach(cleanup)` when it
// detects global test hooks (`vitest.config.ts` doesn't set `test.globals`,
// deliberately matching the rest of this package's explicit-import style) —
// without this, each test in this file would render on top of the last.
afterEach(cleanup);

describe('MealStructureSection', () => {
  // RED test 1: changing ONLY one field (mealsEnabled) and submitting sends
  // a request payload containing ONLY that field.
  it('submits a patch containing only mealsEnabled when only that field changed', async () => {
    const { requests } = renderWithUrql(
      <MealStructureSection
        householdId="hh-1"
        initialMealsEnabled={['breakfast']}
        initialMealStructure={initialMealStructure}
      />,
      () => ({
        data: {
          updateHouseholdSettings: {
            id: 'hh-1',
            settings: {
              mealsEnabled: ['breakfast', 'lunch'],
              mealStructure: initialMealStructure,
              cuisineTier1: [],
              cuisineTier2Weights: '{}',
              dietaryTags: [],
              allergens: [],
              skipIngredients: [],
            },
          },
        },
      }),
    );

    fireEvent.click(screen.getByLabelText('Enable Lunch'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const input = requests[0]?.variables.input as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(['mealsEnabled']);
    expect(input.mealsEnabled).toEqual(['breakfast', 'lunch']);
    expect(requests[0]?.variables.householdId).toBe('hh-1');
  });

  // RED test 4: a server-side validation error renders inline, never a
  // silent no-op.
  it('renders a server-side error inline', async () => {
    renderWithUrql(
      <MealStructureSection
        householdId="hh-1"
        initialMealsEnabled={['breakfast']}
        initialMealStructure={initialMealStructure}
      />,
      () => ({ data: null, errors: [{ message: 'mealsEnabled must contain at least one meal.' }] }),
    );

    fireEvent.click(screen.getByLabelText('Enable Lunch'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/mealsEnabled must contain/));
  });

  it('disables Save until something actually changed', () => {
    renderWithUrql(
      <MealStructureSection
        householdId="hh-1"
        initialMealsEnabled={['breakfast']}
        initialMealStructure={initialMealStructure}
      />,
      () => ({ data: null }),
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
