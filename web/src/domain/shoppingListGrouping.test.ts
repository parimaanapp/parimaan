import { describe, expect, it } from 'vitest';
import { groupShoppingListItemsByCategory, shoppingListCategoryLabel } from './shoppingListGrouping';

describe('shoppingListCategoryLabel', () => {
  it('formats snake_case into a capitalized, spaced label', () => {
    expect(shoppingListCategoryLabel('dry_goods')).toBe('Dry goods');
    expect(shoppingListCategoryLabel('other')).toBe('Other');
  });
});

describe('groupShoppingListItemsByCategory', () => {
  it('groups known categories in the defined stable order', () => {
    const items = [
      { id: '1', category: 'frozen' },
      { id: '2', category: 'produce' },
      { id: '3', category: 'dairy' },
    ];

    const groups = groupShoppingListItemsByCategory(items);

    expect(groups.map((g) => g.category)).toEqual(['produce', 'dairy', 'frozen']);
  });

  it('treats singular and plural grain spellings as distinct adjacent buckets', () => {
    const items = [
      { id: '1', category: 'grains' },
      { id: '2', category: 'grain' },
    ];

    const groups = groupShoppingListItemsByCategory(items);

    expect(groups.map((g) => g.category)).toEqual(['grain', 'grains']);
  });

  it('puts a null category into the trailing "other" bucket', () => {
    const items = [
      { id: '1', category: 'produce' },
      { id: '2', category: null },
    ];

    const groups = groupShoppingListItemsByCategory(items);

    expect(groups.map((g) => g.category)).toEqual(['produce', 'other']);
  });
});
