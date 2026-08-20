/// The four `MealType` values from `shared/schema.graphql`.
///
/// Unlike `household.dart`'s settings lists — which carry the server's enum
/// value *names* as plain `String`s because nothing consumed their meaning
/// yet — the setup wizard genuinely needs a closed set: it renders one toggle
/// per meal and sends the selection back as `mealsEnabled`. A `String`-typed
/// selection there would let a typo reach the server as a `VALIDATION` error
/// instead of failing to compile.
///
/// There is deliberately no `unknown` member. `household.dart`'s enums need
/// one because they *decode* whatever the server sends; this one only ever
/// *encodes* a user's choice, so an unknown value has nothing to represent.
/// The decode direction is still `List<String>`, and stays that way.
enum MealType {
  breakfast,
  lunch,
  snacks,
  dinner;

  /// The exact `MealType` value name in `shared/schema.graphql`. Equal to
  /// [name] for all four, which is asserted rather than assumed — if the
  /// schema ever grows a value whose Dart name has to differ (the way
  /// `past_due`/`pastDue` does), this is the seam that absorbs it.
  String get wireValue => name;

  /// Wireframe screen 2.2 copy.
  String get displayLabel => switch (this) {
    MealType.breakfast => 'Breakfast',
    MealType.lunch => 'Lunch',
    MealType.snacks => 'Snacks',
    MealType.dinner => 'Dinner',
  };

  /// The one-line explanation under each toggle, wireframe screen 2.2.
  String get description => switch (this) {
    MealType.breakfast => '1 recipe per day (e.g. Poha, Idli)',
    MealType.lunch => 'Up to 3 types × 3 each',
    MealType.snacks => 'Between-meal items',
    MealType.dinner => 'Same structure as lunch',
  };
}

/// The meals the setup wizard actually offers, in wireframe order.
///
/// ## Why `snacks` is missing, and where it goes instead
///
/// The schema has four `MealType` values; wireframe screen 2.2 draws exactly
/// three toggles — Breakfast, Lunch, Dinner — and no fourth. Two options were
/// available: add a Snacks toggle the design does not have, or follow the
/// design and leave snacks alone. This takes the second.
///
/// The consequence is precise and worth naming: `mealsEnabled` is a **whole
/// list replacement**, not a set of per-meal flags, so a patch built from
/// these three can never include `snacks` — meaning the wizard *clears* any
/// server-side snacks default rather than preserving it. That is the correct
/// reading of a screen whose copy is "Toggle on the meals you plan weekly":
/// a meal the user was never shown is a meal they did not opt into. Snacks
/// remains reachable through the Settings → Meal structure screen (wireframe
/// 4.1), which is a later slice.
const List<MealType> wizardMealTypes = <MealType>[
  MealType.breakfast,
  MealType.lunch,
  MealType.dinner,
];

/// All three wizard meals start on, per wireframe screen 2.2.
const Set<MealType> defaultMealsEnabled = <MealType>{
  MealType.breakfast,
  MealType.lunch,
  MealType.dinner,
};
