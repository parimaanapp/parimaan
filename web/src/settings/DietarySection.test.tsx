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

  it('blocks saving when no eating style is selected, and explains why (M3)', async () => {
    const { requests } = renderWithUrql(
      <DietarySection
        householdId="hh-1"
        initialDietaryTags={['veg', 'gluten_free']}
        initialAllergens={[]}
        initialSkipIngredients={[]}
      />,
      () => ({ data: { updateHouseholdSettings: { id: 'hh-1', settings: {} } } }),
    );

    fireEvent.click(screen.getByLabelText('Vegetarian'));

    expect(screen.getByRole('alert').textContent).toContain('at least one eating style');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(requests).toHaveLength(0);

    fireEvent.click(screen.getByLabelText('Non-vegetarian'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a legacy household with no style can still save allergens, without a style alert (F5)', async () => {
    const { requests } = renderWithUrql(
      <DietarySection
        householdId="hh-1"
        initialDietaryTags={['gluten_free']}
        initialAllergens={[]}
        initialSkipIngredients={[]}
      />,
      () => ({ data: { updateHouseholdSettings: { id: 'hh-1', settings: {} } } }),
    );

    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('Add allergens'), { target: { value: 'peanuts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add allergen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const input = requests[0]?.variables.input as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(['allergens']);
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
