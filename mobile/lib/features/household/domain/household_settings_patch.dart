import 'cuisine_taxonomy.dart';
import 'dietary_tag.dart';
import 'meal_structure.dart';
import 'meal_type.dart';

/// A partial patch for `Mutation.updateHouseholdSettings`, mirroring the
/// GraphQL `HouseholdSettingsInput`.
///
/// ## `null` means absent, and that is the whole model
///
/// The server's contract has three states per field — *absent* (leave
/// unchanged), *a value* (set it), and *explicit `null`* (rejected; clearing
/// is not supported). Dart's `null` can only express two of those, so a
/// sentinel or a builder would be needed to model all three.
///
/// This deliberately models **two**: `null` here means absent. That is safe
/// precisely because the third state does not exist server-side — an explicit
/// `null` is a `VALIDATION` error, so there is nothing this type could
/// usefully encode that it currently cannot. Every field the wizard clears
/// (no dietary tags, no allergens) is sent as an **empty list**, which is a
/// value, not an absence — see [HouseholdSettingsPatch.dietary]. If the API
/// ever grows a real "clear this field" operation, *that* is when a sentinel
/// earns its complexity; adding one now would be untested machinery for a
/// state the server rejects.
///
/// ## Why the fields are typed enums, not strings
///
/// `HouseholdSettings` (in `household.dart`) decodes these as `List<String>`
/// because it carries whatever the server sends, including values this build
/// has never heard of. This type goes the other way — it only ever encodes a
/// user's choice — so a closed enum is both possible and better: an
/// unrepresentable value fails to compile instead of failing validation.
class HouseholdSettingsPatch {
  /// A patch with any subset of fields.
  ///
  /// The assert mirrors the server's own `.refine(...)`: a patch with every
  /// field absent is rejected as `VALIDATION`, and there is nothing a caller
  /// could have meant by it. Catching it at the construction site rather than
  /// after a round trip is the point — this is a programming error, not user
  /// input, so unlike `household_name.dart`'s validation it is *not* deferred
  /// to the server.
  const HouseholdSettingsPatch({
    this.mealsEnabled,
    this.mealStructureJson,
    this.cuisineTier1,
    this.cuisineTier2WeightsJson,
    this.dietaryTags,
    this.allergens,
    this.skipIngredients,
  }) : assert(
         mealsEnabled != null ||
             mealStructureJson != null ||
             cuisineTier1 != null ||
             cuisineTier2WeightsJson != null ||
             dietaryTags != null ||
             allergens != null ||
             skipIngredients != null,
         'A patch must contain at least one field — the server rejects an '
         'all-absent input as VALIDATION.',
       );

  /// Wizard step 1/4 (screen 2.2).
  ///
  /// Emits schema order rather than the order the user tapped, so two
  /// households that enabled the same meals produce byte-identical patches.
  factory HouseholdSettingsPatch.meals(Set<MealType> meals) =>
      HouseholdSettingsPatch(
        mealsEnabled: MealType.values
            .where(meals.contains)
            .toList(growable: false),
      );

  /// Wizard step 2/4 (screen 2.3). Sends only the `lunch` key.
  factory HouseholdSettingsPatch.lunchStructure(LunchMealStructure structure) =>
      HouseholdSettingsPatch(mealStructureJson: structure.toWireJson());

  /// Wizard step 3/4, first frame (screen 2.4). Schema order, as with
  /// [HouseholdSettingsPatch.meals].
  factory HouseholdSettingsPatch.cuisineRegions(Set<CuisineRegion> regions) =>
      HouseholdSettingsPatch(
        cuisineTier1: CuisineRegion.values
            .where(regions.contains)
            .toList(growable: false),
      );

  /// Wizard step 3/4, second frame (screen 2.5).
  factory HouseholdSettingsPatch.cuisineWeights(
    Map<String, CuisineBias> weights,
  ) => HouseholdSettingsPatch(
    cuisineTier2WeightsJson: encodeCuisineTier2Weights(weights),
  );

  /// Wizard step 4/4 (screen 2.6) — the one step that owns three fields.
  ///
  /// All three are always sent, empty lists included: on this screen "no
  /// allergens" is a statement the user made, not a field they left alone.
  factory HouseholdSettingsPatch.dietary({
    required Set<DietaryTag> tags,
    required List<String> allergens,
    required List<String> skipIngredients,
  }) => HouseholdSettingsPatch(
    dietaryTags: DietaryTag.values.where(tags.contains).toList(growable: false),
    allergens: List<String>.unmodifiable(allergens),
    skipIngredients: List<String>.unmodifiable(skipIngredients),
  );

  final List<MealType>? mealsEnabled;

  /// `AWSJSON` — already a JSON string, not a `Map`. See `meal_structure.dart`.
  final String? mealStructureJson;

  final List<CuisineRegion>? cuisineTier1;

  /// `AWSJSON` — see [mealStructureJson].
  final String? cuisineTier2WeightsJson;

  final List<DietaryTag>? dietaryTags;
  final List<String>? allergens;
  final List<String>? skipIngredients;

  /// How many fields this patch will actually send.
  ///
  /// Exists for tests and for logging — "patch per step" is a locked decision
  /// and this is what makes a step that quietly grew a second field visible.
  int get fieldCount => <Object?>[
    mealsEnabled,
    mealStructureJson,
    cuisineTier1,
    cuisineTier2WeightsJson,
    dietaryTags,
    allergens,
    skipIngredients,
  ].where((Object? field) => field != null).length;

  @override
  String toString() => 'HouseholdSettingsPatch($fieldCount field(s))';
}
