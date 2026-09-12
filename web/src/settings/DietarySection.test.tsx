// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DietarySection } from './DietarySection';
import { renderWithUrql } from './testUtils';

afterEach(cleanup);

describe('DietarySection', () => {
  it('submits a patch containing only dietaryTags when only a tag changed', async () => {
    const { requests } = renderWithUrql(
      <DietarySection
        householdId="hh-1"
        initialDietaryTags={['veg']}
        initialAllergens={['peanuts']}
        initialSkipIngredients={[]}
      />,
      () => ({ data: { updateHouseholdSettings: { id: 'hh-1', settings: {} } } }),
    );

    fireEvent.click(screen.getByLabelText('Vegan'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const input = requests[0]?.variables.input as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(['dietaryTags']);
    expect(input.dietaryTags).toEqual(['veg', 'vegan']);
  });

  it('adding an allergen patches only allergens', async () => {
    const { requests } = renderWithUrql(
      <DietarySection
        householdId="hh-1"
        initialDietaryTags={['veg']}
        initialAllergens={['peanuts']}
        initialSkipIngredients={[]}
      />,
      () => ({ data: { updateHouseholdSettings: { id: 'hh-1', settings: {} } } }),
    );

    fireEvent.change(screen.getByLabelText('Add allergens'), { target: { value: 'shellfish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add allergen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const input = requests[0]?.variables.input as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(['allergens']);
    expect(input.allergens).toEqual(['peanuts', 'shellfish']);
  });
});
