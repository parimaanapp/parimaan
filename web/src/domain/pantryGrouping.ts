/**
 * W18 S4's pantry-category grouping for the dashboard's Pantry section.
 * `pantry_items.category` is free TEXT server-side, not a closed enum
 * (`api/src/domain/pantryCategories.ts`'s own doc) — `KNOWN_PANTRY_CATEGORIES`
 * below is a byte-for-byte mirror of that file's list (and of
 * `mobile/lib/features/pantry/domain/pantry_category.dart`'s own
 * `knownPantryCategories`), kept in sync by hand the same way the mobile
 * client already does, since there is no shared codegen between the three.
 * The grouping/ordering algorithm itself mirrors
 * `mobile/lib/features/shopping_list/domain/shopping_list_category_order.dart`'s
 * `groupShoppingListItemsByCategory` — every known category present (in
 * this defined order), then any other real category alphabetically, then a
 * trailing `other` bucket for a `null` category — so the dashboard's own
 * pantry grouping is stable across a refetch, not re-derived from whatever
 * order the query happens to return.
 */

export interface PantryItemLike {
  category: string | null;
}

export const KNOWN_PANTRY_CATEGORIES = [
  'dal',
  'spice',
  'dairy',
  'produce',
  'dry_goods',
  'grain',
  'oil',
  'condiment',
  'frozen',
  'other',
] as const;

export const OTHER_PANTRY_CATEGORY = 'other';

export interface PantryCategoryGroup<T extends PantryItemLike> {
  category: string;
  items: T[];
}

/** `dry_goods` -> `Dry goods`. Display formatting only, mirroring `pantryCategoryLabel`. */
export const pantryCategoryLabel = (category: string): string => {
  const spaced = category.replace(/_/g, ' ');
  if (spaced.length === 0) {
    return spaced;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const groupPantryItemsByCategory = <T extends PantryItemLike>(items: T[]): PantryCategoryGroup<T>[] => {
  const byCategory = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category ?? OTHER_PANTRY_CATEGORY;
    const existing = byCategory.get(key);
    if (existing) {
      existing.push(item);
    } else {
      byCategory.set(key, [item]);
    }
  }

  const knownPresent = KNOWN_PANTRY_CATEGORIES.filter(
    (category) => category !== OTHER_PANTRY_CATEGORY && byCategory.has(category),
  );
  const unknownPresent = [...byCategory.keys()]
    .filter((key) => key !== OTHER_PANTRY_CATEGORY && !(KNOWN_PANTRY_CATEGORIES as readonly string[]).includes(key))
    .sort();
  const orderedKeys = [
    ...knownPresent,
    ...unknownPresent,
    ...(byCategory.has(OTHER_PANTRY_CATEGORY) ? [OTHER_PANTRY_CATEGORY] : []),
  ];

  return orderedKeys.map((category) => ({ category, items: byCategory.get(category) as T[] }));
};
