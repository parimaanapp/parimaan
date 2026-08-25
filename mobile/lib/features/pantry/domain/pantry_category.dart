/// The client-side mirror of `api/src/domain/pantryCategories.ts`'s known
/// set — kept in sync by hand (there is no shared codegen between the two
/// languages for this list). Used for the category filter chips on the
/// Pantry List; `category` itself stays free text server-side
/// (E2E_MVP_PLAN.md §11.2.4), so this is a display/filter convenience, not a
/// validated enum — an item whose category isn't in this list still renders
/// fine, it just has no matching chip.
const List<String> knownPantryCategories = <String>[
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
];

/// `dry_goods` -> `Dry goods`. Display formatting only — the wire value
/// (used for the `category` filter argument and stored on the item) is
/// always the raw snake_case string.
String pantryCategoryLabel(String category) {
  final String spaced = category.replaceAll('_', ' ');
  if (spaced.isEmpty) {
    return spaced;
  }
  return spaced[0].toUpperCase() + spaced.substring(1);
}
