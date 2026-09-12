/**
 * W18 S4's TypeScript port of `mobile/lib/features/shopping_list/domain/
 * shopping_list_category_order.dart`'s `groupShoppingListItemsByCategory` —
 * the dashboard's own Shopping list section must group by the same stable,
 * defined category order mobile already uses, not a new, possibly-diverging
 * one. Both singular `grain` and plural `grains` are listed adjacently,
 * deliberately, for the identical reason the Dart file documents: the
 * server-side `recipe_ingredients.category` column has no canonical form.
 */

export interface ShoppingListItemLike {
  category: string | null;
}

const KNOWN_SHOPPING_LIST_CATEGORY_ORDER = [
  'produce',
  'dal',
  'dairy',
  'grain',
  'grains',
  'dry_goods',
  'condiment',
  'frozen',
] as const;

export const OTHER_SHOPPING_LIST_CATEGORY = 'other';

export interface ShoppingListCategoryGroup<T extends ShoppingListItemLike> {
  category: string;
  items: T[];
}

/** `dry_goods` -> `Dry goods`, `other` -> `Other`. Mirrors `shoppingListCategoryLabel`. */
export const shoppingListCategoryLabel = (category: string): string => {
  const spaced = category.replace(/_/g, ' ');
  if (spaced.length === 0) {
    return spaced;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const groupShoppingListItemsByCategory = <T extends ShoppingListItemLike>(
  items: T[],
): ShoppingListCategoryGroup<T>[] => {
  const byCategory = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category ?? OTHER_SHOPPING_LIST_CATEGORY;
    const existing = byCategory.get(key);
    if (existing) {
      existing.push(item);
    } else {
      byCategory.set(key, [item]);
    }
  }

  const knownPresent = KNOWN_SHOPPING_LIST_CATEGORY_ORDER.filter((category) => byCategory.has(category));
  const unknownPresent = [...byCategory.keys()]
    .filter(
      (key) =>
        key !== OTHER_SHOPPING_LIST_CATEGORY &&
        !(KNOWN_SHOPPING_LIST_CATEGORY_ORDER as readonly string[]).includes(key),
    )
    .sort();
  const orderedKeys = [
    ...knownPresent,
    ...unknownPresent,
    ...(byCategory.has(OTHER_SHOPPING_LIST_CATEGORY) ? [OTHER_SHOPPING_LIST_CATEGORY] : []),
  ];

  return orderedKeys.map((category) => ({ category, items: byCategory.get(category) as T[] }));
};
