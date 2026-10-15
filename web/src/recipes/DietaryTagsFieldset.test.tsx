// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DietaryTagsFieldset } from './DietaryTagsFieldset';

afterEach(cleanup);

describe('recipes DietaryTagsFieldset', () => {
  it('shows the shared human labels, not raw wire values', () => {
    render(<DietaryTagsFieldset selected={[]} onChange={vi.fn()} />);

    for (const label of ['Vegetarian', 'Non-vegetarian', 'Vegan', 'Egg friendly', 'Jain', 'Gluten free', 'Dairy free']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.queryByText('non_veg')).toBeNull();
  });

  it('selecting Non-vegetarian removes veg, vegan and jain (M2)', () => {
    const onChange = vi.fn();
    render(<DietaryTagsFieldset selected={['veg', 'vegan', 'jain', 'gluten_free']} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Non-vegetarian'));

    expect(onChange).toHaveBeenCalledWith(['gluten_free', 'non_veg']);
  });

  it.each([
    ['Vegetarian', 'veg'],
    ['Vegan', 'vegan'],
    ['Jain', 'jain'],
  ])('selecting %s removes non_veg (M2)', (label, tag) => {
    const onChange = vi.fn();
    render(<DietaryTagsFieldset selected={['non_veg', 'dairy_free']} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(label));

    expect(onChange).toHaveBeenCalledWith(['dairy_free', tag]);
  });

  it('unselecting a tag only removes it', () => {
    const onChange = vi.fn();
    render(<DietaryTagsFieldset selected={['veg', 'gluten_free']} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Gluten free'));

    expect(onChange).toHaveBeenCalledWith(['veg']);
  });
});
