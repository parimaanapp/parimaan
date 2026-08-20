/// The six `DietaryTag` values from `shared/schema.graphql`.
///
/// Two of the six have display copy that differs from the wire value, and
/// wireframe screen 2.6 uses the display copy — so the mapping is spelled out
/// here rather than derived, because deriving it would be wrong:
///
/// | Wireframe chip | `DietaryTag` value |
/// |---|---|
/// | `egg-friendly` | `eggetarian` |
/// | `GF` | `gluten_free` |
///
/// The other four (`veg`, `vegan`, `jain`, `dairy-free`) differ only in the
/// hyphen/underscore, which is still a translation and still lives in
/// [wireValue] rather than being produced by string surgery at a call site.
///
/// Same "encode-only, so no `unknown` member" rule as `meal_type.dart`.
enum DietaryTag {
  veg,
  vegan,
  jain,
  eggetarian,
  glutenFree,
  dairyFree;

  /// The exact `DietaryTag` value name in `shared/schema.graphql`.
  String get wireValue => switch (this) {
    DietaryTag.veg => 'veg',
    DietaryTag.vegan => 'vegan',
    DietaryTag.jain => 'jain',
    DietaryTag.eggetarian => 'eggetarian',
    DietaryTag.glutenFree => 'gluten_free',
    DietaryTag.dairyFree => 'dairy_free',
  };

  /// Wireframe screen 2.6 chip copy — lower-case except `GF`, which the
  /// design source draws as an initialism.
  String get displayLabel => switch (this) {
    DietaryTag.veg => 'veg',
    DietaryTag.vegan => 'vegan',
    DietaryTag.jain => 'jain',
    DietaryTag.eggetarian => 'egg-friendly',
    DietaryTag.glutenFree => 'GF',
    DietaryTag.dairyFree => 'dairy-free',
  };
}

/// The two chips wireframe screen 2.6 draws pre-selected.
const Set<DietaryTag> defaultDietaryTags = <DietaryTag>{
  DietaryTag.veg,
  DietaryTag.eggetarian,
};
