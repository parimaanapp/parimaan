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
    MealType.snacks => '1 recipe per day (e.g. Chai, Khakhra)',
    MealType.dinner => 'Same structure as lunch',
  };
}

/// The meals the setup wizard offers, in wireframe order.
///
/// Snacks joined the wizard in Build A (A7, `E2E_MVP_PLAN.md` §32 #4): it is
/// one slot per day with no structure page, and the plan, auto-fill and
/// shopping list already honour it. It starts *off* ([defaultMealsEnabled]).
const List<MealType> wizardMealTypes = <MealType>[
  MealType.breakfast,
  MealType.lunch,
  MealType.snacks,
  MealType.dinner,
];

/// The meals the Settings "Meals to plan" row offers — all four, including
/// Snacks (`W13 S3`).
///
/// `WhichMealsScreen` renders [wizardMealTypes] in [WizardFlow.create] and
/// this list in [WizardFlow.edit] — the flow context the screen already
/// receives is what selects between them, so there is no second screen and
/// no duplicated toggle widget. This is [MealType.values] itself rather than
/// a hand-picked subset, on purpose: a fifth `MealType` added to the schema
/// should reach Settings without anyone remembering to update this list.
const List<MealType> editMealTypes = MealType.values;

/// Breakfast, lunch and dinner start on; snacks is opt-in.
const Set<MealType> defaultMealsEnabled = <MealType>{
  MealType.breakfast,
  MealType.lunch,
  MealType.dinner,
};
