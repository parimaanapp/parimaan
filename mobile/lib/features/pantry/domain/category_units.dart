import 'package:flutter/foundation.dart';

import 'pantry_unit.dart';

/// Allowed units for one category, default first.
@immutable
class CategoryUnits {
  const CategoryUnits(this.units);

  /// Ordered allow-list; [defaultUnit] is always `units.first`.
  final List<String> units;

  String get defaultUnit => units.first;
}

/// Single source of truth for which units make sense per category.
///
/// Derived from `docs/catalog/ingredients.csv` (union of each
/// `app_category`'s `allowed_units`, default unit first) and pinned against
/// it by `category_units_test.dart`. Interim until the full catalog (Build
/// B) replaces it. Keys must equal `knownPantryCategories`.
const Map<String, CategoryUnits> categoryUnits = <String, CategoryUnits>{
  'dal': CategoryUnits(<String>['g', 'kg', 'cup']),
  'grain': CategoryUnits(<String>['g', 'kg', 'cup']),
  'spice': CategoryUnits(<String>['g', 'tsp', 'tbsp', 'packet', 'piece']),
  'dairy': CategoryUnits(
    <String>['g', 'ml', 'kg', 'l', 'cup', 'tbsp', 'packet', 'piece'],
  ),
  'eggs': CategoryUnits(<String>['piece', 'dozen']),
  'produce': CategoryUnits(
    <String>['g', 'kg', 'piece', 'bunch', 'dozen', 'tbsp'],
  ),
  'dry_goods': CategoryUnits(<String>['g', 'kg', 'cup', 'tbsp', 'tsp']),
  'oil': CategoryUnits(
    <String>['ml', 'l', 'tbsp', 'tsp', 'cup', 'bottle', 'packet', 'g', 'kg'],
  ),
  'meat_fish': CategoryUnits(<String>['g', 'kg', 'piece']),
  'condiment': CategoryUnits(
    <String>['g', 'ml', 'tbsp', 'tsp', 'bottle', 'jar', 'packet'],
  ),
  'bakery': CategoryUnits(<String>['piece', 'slice', 'loaf', 'g', 'packet']),
  'snacks': CategoryUnits(<String>['packet', 'g', 'piece']),
  'beverages': CategoryUnits(
    <String>['g', 'ml', 'l', 'cup', 'tsp', 'tbsp', 'packet', 'bottle'],
  ),
  'frozen': CategoryUnits(<String>['g', 'kg', 'packet', 'piece']),
  'other': CategoryUnits(<String>['g', 'tsp', 'tbsp', 'packet']),
};

/// A recipe line carries no category, so its picker offers the union of the
/// units relevant to recipes.
const List<String> recipeUnits = <String>[
  'g',
  'kg',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'cup',
  'piece',
  'bunch',
  'pinch',
  'packet',
  'jar',
  'bottle',
];

/// Ordered units for [category]; every known unit when the category is
/// null or not in the table (free-text categories stay usable).
List<String> unitsForCategory(String? category) =>
    categoryUnits[category]?.units ?? knownPantryUnits;

/// The category's default unit, or `null` when the category is unknown.
String? defaultUnitForCategory(String? category) =>
    categoryUnits[category]?.units.first;

/// Case-insensitive, trimmed membership test; never rewrites [unit].
bool unitInList(List<String> units, String? unit) {
  final String needle = (unit ?? '').trim().toLowerCase();
  return units.any((String u) => u.toLowerCase() == needle);
}

/// [unitsForCategory] plus [current] appended when it is non-empty and not
/// in the list, so an existing item's out-of-list unit never disappears.
List<String> unitsWithCurrent(String? category, String? current) {
  final List<String> units = unitsForCategory(category);
  final String trimmed = (current ?? '').trim();
  if (trimmed.isEmpty || unitInList(units, trimmed)) {
    return units;
  }
  return <String>[...units, trimmed];
}
