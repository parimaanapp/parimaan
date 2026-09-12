import { describe, expect, it } from 'vitest';
import { groupPantryItemsByCategory, pantryCategoryLabel } from './pantryGrouping';

describe('pantryCategoryLabel', () => {
  it('formats snake_case into a capitalized, spaced label', () => {
    expect(pantryCategoryLabel('dry_goods')).toBe('Dry goods');
    expect(pantryCategoryLabel('dal')).toBe('Dal');
  });
});

describe('groupPantryItemsByCategory', () => {
  it('groups known categories in the defined stable order', () => {
    const items = [
      { id: '1', category: 'frozen' },
      { id: '2', category: 'dal' },
      { id: '3', category: 'dairy' },
    ];

    const groups = groupPantryItemsByCategory(items);

    expect(groups.map((g) => g.category)).toEqual(['dal', 'dairy', 'frozen']);
  });

  it('puts a null category into the trailing "other" bucket', () => {
    const items = [
      { id: '1', category: 'dal' },
      { id: '2', category: null },
    ];

    const groups = groupPantryItemsByCategory(items);

    expect(groups.map((g) => g.category)).toEqual(['dal', 'other']);
    expect(groups[1]?.items).toEqual([{ id: '2', category: null }]);
  });

  it('sorts an unrecognised category alphabetically, before "other" but after known ones', () => {
    const items = [
      { id: '1', category: 'dal' },
      { id: '2', category: 'exotic_spice' },
      { id: '3', category: null },
    ];

    const groups = groupPantryItemsByCategory(items);

    expect(groups.map((g) => g.category)).toEqual(['dal', 'exotic_spice', 'other']);
  });

  it('is stable regardless of input order', () => {
    const a = [{ id: '1', category: 'frozen' }, { id: '2', category: 'dal' }];
    const b = [{ id: '2', category: 'dal' }, { id: '1', category: 'frozen' }];

    expect(groupPantryItemsByCategory(a).map((g) => g.category)).toEqual(
      groupPantryItemsByCategory(b).map((g) => g.category),
    );
  });
});
