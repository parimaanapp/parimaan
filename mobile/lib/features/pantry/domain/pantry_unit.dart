/// The client-side mirror of `api/src/domain/pantryUnits.ts`'s known set —
/// kept in sync by hand, same rationale as `pantry_category.dart`'s
/// identical list. Not used by the read path (S5); this is here now so S6's
/// manual-add unit picker has a ready-made source list rather than
/// duplicating it into that slice.
const List<String> knownPantryUnits = <String>[
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'packet',
  'bunch',
  'tsp',
  'tbsp',
  'cup',
];
