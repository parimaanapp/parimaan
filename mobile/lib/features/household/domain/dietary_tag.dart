/// The seven `DietaryTag` values from `shared/schema.graphql`.
///
/// Display copy is sentence case (E2E_MVP_PLAN.md §32.6) and several labels
/// differ from the wire value, so the mapping is spelled out in
/// [displayLabel] and [wireValue] rather than produced by string surgery at
/// a call site.
///
/// Same "encode-only, so no `unknown` member" rule as `meal_type.dart`.
enum DietaryTag {
  veg,
  nonVeg,
  vegan,
  jain,
  eggetarian,
  glutenFree,
  dairyFree;

  /// The exact `DietaryTag` value name in `shared/schema.graphql`.
  String get wireValue => switch (this) {
    DietaryTag.veg => 'veg',
    DietaryTag.nonVeg => 'non_veg',
    DietaryTag.vegan => 'vegan',
    DietaryTag.jain => 'jain',
    DietaryTag.eggetarian => 'eggetarian',
    DietaryTag.glutenFree => 'gluten_free',
    DietaryTag.dairyFree => 'dairy_free',
  };

  /// Chip copy, sentence case (§32.6).
  String get displayLabel => switch (this) {
    DietaryTag.veg => 'Vegetarian',
    DietaryTag.nonVeg => 'Non-vegetarian',
    DietaryTag.vegan => 'Vegan',
    DietaryTag.jain => 'Jain',
    DietaryTag.eggetarian => 'Egg friendly',
    DietaryTag.glutenFree => 'Gluten free',
    DietaryTag.dairyFree => 'Dairy free',
  };
}

/// The two chips pre-selected on the setup screen.
const Set<DietaryTag> defaultDietaryTags = <DietaryTag>{
  DietaryTag.veg,
  DietaryTag.eggetarian,
};
