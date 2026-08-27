/// The meal-slot categorization a recipe fills — `RecipeRole` in
/// `shared/schema.graphql`. Unrelated to `HouseholdRole` (primary/member)
/// despite the shared name (E2E_MVP_PLAN.md §12.7 D1).
///
/// [unknown] is not a real wire value — same forward-compatibility rule as
/// `HouseholdRole.unknown` (`features/household/domain/household.dart`): the
/// landing spot for a value this build predates, via `build.yaml`'s
/// `global_enum_fallbacks: true`.
enum RecipeRole {
  breakfast,
  carb,
  sabziDal,
  accompaniment,
  snack,
  sweet,
  drink,
  unknown;

  /// The exact `RecipeRole` value name in `shared/schema.graphql`. Every
  /// multi-word value is snake_case, so `sabziDal` is the only member whose
  /// wire value differs from [name] — same pattern as
  /// `CuisineRegion.wireValue`.
  String get wireValue => switch (this) {
    RecipeRole.breakfast => 'breakfast',
    RecipeRole.carb => 'carb',
    RecipeRole.sabziDal => 'sabzi_dal',
    RecipeRole.accompaniment => 'accompaniment',
    RecipeRole.snack => 'snack',
    RecipeRole.sweet => 'sweet',
    RecipeRole.drink => 'drink',
    RecipeRole.unknown => 'unknown',
  };

  /// Role filter chip / recipe-card copy.
  String get displayLabel => switch (this) {
    RecipeRole.breakfast => 'Breakfast',
    RecipeRole.carb => 'Carb',
    RecipeRole.sabziDal => 'Sabzi/Dal',
    RecipeRole.accompaniment => 'Accompaniment',
    RecipeRole.snack => 'Snack',
    RecipeRole.sweet => 'Sweet',
    RecipeRole.drink => 'Drink',
    RecipeRole.unknown => 'Other',
  };

  /// The roles a filter chip row offers — every real value except [unknown],
  /// which has nothing for a user to tap toward (PRD §7.1: `drink` is a real
  /// role, shown here, even though it is post-MVP scope for weekly planning).
  static const List<RecipeRole> selectable = <RecipeRole>[
    RecipeRole.breakfast,
    RecipeRole.carb,
    RecipeRole.sabziDal,
    RecipeRole.accompaniment,
    RecipeRole.snack,
    RecipeRole.sweet,
    RecipeRole.drink,
  ];
}
