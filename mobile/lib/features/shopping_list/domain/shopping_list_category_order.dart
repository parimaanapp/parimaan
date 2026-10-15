import 'shopping_list_item.dart';

/// A defined, stable display order for [ShoppingListItem.category] groups —
/// the mobile-side answer to E2E_MVP_PLAN.md §17.3 S6's "categories render
/// in a stable, defined order" RED test.
///
/// `recipe_ingredients.category` is free TEXT server-side (same
/// "no closed enum" reasoning `api/src/domain/pantryCategories.ts` and
/// `pantry_category.dart`'s own client-side mirror already document for
/// `pantry_items.category` — a DIFFERENT column with a different, though
/// overlapping, value set). The server's own `categorize()`
/// (`api/src/domain/shoppingListGeneration.ts`) groups by first-appearance
/// order, which is NOT stable across a refetch/regenerate (item order can
/// shift), so the mobile UI cannot reuse it directly — this list is this
/// screen-layer's own, independently defined order.
///
/// Not a validated enum: a category outside this list still renders, sorted
/// alphabetically after every known one, before the trailing `null`/`other`
/// bucket — same "unrecognised value passes through, never rejected"
/// posture as `pantryCategoryLabel`.
const List<String> _knownShoppingListCategoryOrder = <String>[
  'produce',
  'dal',
  'dairy',
  // `grains` and case/whitespace variants are folded onto the canonical
  // value by [normalizeShoppingListCategory] before grouping.
  'grain',
  'dry_goods',
  'spice',
  'eggs',
  'oil',
  'meat_fish',
  'condiment',
  'bakery',
  'snacks',
  'beverages',
  'frozen',
];

/// Approved display labels (`docs/catalog/decisions.md`, "Ingredient
/// categories"). `meat_fish` / `dry_goods` are stored values; these are the
/// labels. Singular and plural grain spellings share one label.
const Map<String, String> _categoryLabels = <String, String>{
  'dal': 'Dal',
  'grain': 'Grain',
  'spice': 'Spice',
  'dairy': 'Dairy',
  'eggs': 'Eggs',
  'produce': 'Produce',
  'dry_goods': 'Dry Goods',
  'oil': 'Oil',
  'meat_fish': 'Meat & Fish',
  'condiment': 'Condiment',
  'bakery': 'Bakery',
  'snacks': 'Snacks',
  'beverages': 'Beverages',
  'frozen': 'Frozen',
  'other': 'Other',
};

/// The bucket a `null` [ShoppingListItem.category] (or any category not
/// otherwise recognised as staple-excluded — those never reach the client at
/// all, per S1's server-side exclusion) sorts into last.
const String otherShoppingListCategory = 'other';

/// One category's items, in the stable order [groupShoppingListItemsByCategory]
/// produces.
/// Folds free-text category spellings onto the canonical stored value:
/// trims, lower-cases, maps spaces/hyphens/`&` to the snake_case form
/// (`Dry Goods` -> `dry_goods`, `Meat & Fish` -> `meat_fish`) and `grains`
/// to `grain`. Null or blank becomes [otherShoppingListCategory].
String normalizeShoppingListCategory(String? raw) {
  final String trimmed = (raw ?? '').trim().toLowerCase();
  if (trimmed.isEmpty) return otherShoppingListCategory;
  final String folded = trimmed
      .replaceAll('&', ' ')
      .split(RegExp(r'[\s\-_]+'))
      .where((String part) => part.isNotEmpty)
      .join('_');
  if (folded.isEmpty) return otherShoppingListCategory;
  return folded == 'grains' ? 'grain' : folded;
}

typedef ShoppingListCategoryGroup = ({
  String category,
  List<ShoppingListItem> items,
});

/// Groups [items] by [ShoppingListItem.category], in a STABLE, DEFINED order:
/// every category in [_knownShoppingListCategoryOrder] (in that order, only
/// when it actually has items), then any other real category alphabetically,
/// then [otherShoppingListCategory] last (only when at least one item has a
/// `null` category). Never depends on [items]' own incoming order — two
/// calls with the same items in a different order produce byte-identical
/// output, which is exactly what "stable" means for this RED test: a
/// refetch/regenerate must not reshuffle the sections on screen.
List<ShoppingListCategoryGroup> groupShoppingListItemsByCategory(
  List<ShoppingListItem> items,
) {
  final Map<String, List<ShoppingListItem>> byCategory =
      <String, List<ShoppingListItem>>{};
  for (final ShoppingListItem item in items) {
    final String key = normalizeShoppingListCategory(item.category);
    byCategory.putIfAbsent(key, () => <ShoppingListItem>[]).add(item);
  }

  final List<String> knownPresent = _knownShoppingListCategoryOrder
      .where(byCategory.containsKey)
      .toList(growable: false);
  final List<String> unknownPresent =
      byCategory.keys
          .where(
            (String key) =>
                key != otherShoppingListCategory &&
                !_knownShoppingListCategoryOrder.contains(key),
          )
          .toList()
        ..sort();
  final List<String> orderedKeys = <String>[
    ...knownPresent,
    ...unknownPresent,
    if (byCategory.containsKey(otherShoppingListCategory))
      otherShoppingListCategory,
  ];

  return orderedKeys
      .map(
        (String category) => (category: category, items: byCategory[category]!),
      )
      .toList(growable: false);
}

/// The approved catalog label (`dry_goods` -> `Dry Goods`, `meat_fish` ->
/// `Meat & Fish`); an unknown value falls back to a spaced, capitalised
/// form. Display formatting only.
String shoppingListCategoryLabel(String category) {
  final String? approved = category.trim().isEmpty
      ? null
      : _categoryLabels[normalizeShoppingListCategory(category)];
  if (approved != null) return approved;
  final String spaced = category.replaceAll('_', ' ');
  if (spaced.isEmpty) return spaced;
  return spaced[0].toUpperCase() + spaced.substring(1);
}
