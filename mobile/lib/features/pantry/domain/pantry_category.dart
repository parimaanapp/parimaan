/// The client-side mirror of `api/src/domain/pantryCategories.ts`'s known
/// set — kept in sync by hand (there is no shared codegen between the two
/// languages for this list). Used for the category filter chips on the
/// Pantry List; `category` itself stays free text server-side
/// (E2E_MVP_PLAN.md §11.2.4), so this is a display/filter convenience, not a
/// validated enum — an item whose category isn't in this list still renders
/// fine, it just has no matching chip.
const List<String> knownPantryCategories = <String>[
  'dal',
  'grain',
  'spice',
  'dairy',
  'eggs',
  'produce',
  'dry_goods',
  'oil',
  'meat_fish',
  'condiment',
  'bakery',
  'snacks',
  'beverages',
  'frozen',
  'other',
];

/// Founder-approved display labels (docs/catalog/decisions.md, "UI copy
/// rules"). Wire values stay snake_case.
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

/// Display label for a category wire value. An unknown (free-text) category
/// is humanised (`festival_snacks` -> `Festival snacks`) rather than hidden.
String pantryCategoryLabel(String category) {
  final String? known = _categoryLabels[category];
  if (known != null) {
    return known;
  }
  final String spaced = category.replaceAll('_', ' ');
  if (spaced.isEmpty) {
    return spaced;
  }
  return spaced[0].toUpperCase() + spaced.substring(1);
}
