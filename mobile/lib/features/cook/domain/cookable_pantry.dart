import '../../pantry/domain/pantry_item.dart';

/// W21 D6 — the client twin of `isPantryTooSmall` in the API's
/// `api/src/domain/cookablePantry.ts`. The server is authoritative; this copy
/// lets the trigger screen say "your pantry's a little bare" instantly and
/// offline. Both run the cases in `shared/fixtures/cookable-pantry-cases.json`,
/// so neither can drift from the other unnoticed.
const int minCookablePantryItems = 3;

/// Five spices cannot make a meal: these categories do not count (the staple
/// categories the server's prompt cut also drops first, plus condiments).
const Set<String> _nonMealCategories = <String>{
  'spice',
  'masala',
  'salt',
  'oil',
  'condiment',
};

/// Fewer than [minCookablePantryItems] distinct in-stock items outside the
/// non-meal categories. An uncategorised item counts as food.
bool isPantryTooSmall(Iterable<PantryItem> items) {
  final Set<String> foods = <String>{
    for (final PantryItem item in items)
      if (item.quantity > 0 &&
          !_nonMealCategories.contains(
            item.category?.trim().toLowerCase() ?? '',
          ))
        item.name.trim().toLowerCase(),
  };
  return foods.length < minCookablePantryItems;
}
