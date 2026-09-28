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
  // jar/bottle (W19 S2): a real Gemini vision spike against 59 real pantry
  // photos found >75% of proposed quantities were container counts these
  // two weren't in yet — same count-only family as piece/packet/bunch.
  'jar',
  'bottle',
];
