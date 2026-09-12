// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CuisineSection } from './CuisineSection';
import { renderWithUrql } from './testUtils';

afterEach(cleanup);

describe('CuisineSection', () => {
  // RED test 2: a second, independent field — changing only a cuisine
  // region — sends a request containing ONLY that field, confirming
  // MealStructureSection's own test isn't a one-field fluke.
  it('submits a patch containing only cuisineTier1 when only a region changed', async () => {
    const { requests } = renderWithUrql(
      <CuisineSection householdId="hh-1" initialCuisineTier1={['north_indian']} initialCuisineTier2Weights="{}" />,
      () => ({
        data: {
          updateHouseholdSettings: {
            id: 'hh-1',
            settings: {
              mealsEnabled: [],
              mealStructure: '{}',
              cuisineTier1: ['north_indian', 'south_indian'],
              cuisineTier2Weights: '{}',
              dietaryTags: [],
              allergens: [],
              skipIngredients: [],
            },
          },
        },
      }),
    );

    fireEvent.click(screen.getByLabelText('South Indian'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const input = requests[0]?.variables.input as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(['cuisineTier1']);
    expect(input.cuisineTier1).toEqual(['north_indian', 'south_indian']);
  });

  it('does not include cuisineTier2Weights when a sub-cuisine bias is untouched', async () => {
    const { requests } = renderWithUrql(
      <CuisineSection
        householdId="hh-1"
        initialCuisineTier1={['north_indian']}
        initialCuisineTier2Weights={JSON.stringify({ punjabi: 'more' })}
      />,
      () => ({ data: { updateHouseholdSettings: { id: 'hh-1', settings: {} } } }),
    );

    fireEvent.click(screen.getByLabelText('Pan-India'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const input = requests[0]?.variables.input as Record<string, unknown>;
    expect(input.cuisineTier2Weights).toBeUndefined();
  });
});
