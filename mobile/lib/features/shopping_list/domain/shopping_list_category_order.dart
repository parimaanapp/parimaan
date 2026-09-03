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
  // Both singular AND plural are listed deliberately, adjacent to each
  // other: `recipe_ingredients.category` is free text with no canonical
  // form (this file's own doc), and this codebase's own test fixtures
  // (`shopping_list_fixtures.dart`'s `testShoppingListItem`) already use
  // `'grains'` while `pantry_category.dart`'s mirror of the pantry's
  // (different) vocabulary uses `'grain'` — either spelling reaching this
  // client must land in a defined slot, not fall through to the unknown
  // (alphabetical) bucket. If the server-side vocabulary is ever confirmed
  // to emit only one of the two, drop the other here.
  'grain',
  'grains',
  'dry_goods',
  'condiment',
  'frozen',
];

/// The bucket a `null` [ShoppingListItem.category] (or any category not
/// otherwise recognised as staple-excluded — those never reach the client at
/// all, per S1's server-side exclusion) sorts into last.
const String otherShoppingListCategory = 'other';

/// One category's items, in the stable order [groupShoppingListItemsByCategory]
/// produces.
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
    final String key = item.category ?? otherShoppingListCategory;
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

/// `dry_goods` -> `Dry goods`, `other` -> `Other`. Display formatting only —
/// same shape as `pantry_category.dart`'s `pantryCategoryLabel`.
String shoppingListCategoryLabel(String category) {
  final String spaced = category.replaceAll('_', ' ');
  if (spaced.isEmpty) return spaced;
  return spaced[0].toUpperCase() + spaced.substring(1);
}
