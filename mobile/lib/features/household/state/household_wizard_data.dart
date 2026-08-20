import '../domain/cuisine_taxonomy.dart';
import '../domain/dietary_tag.dart';
import '../domain/household.dart';
import '../domain/meal_structure.dart';
import '../domain/meal_type.dart';

/// Everything the six setup screens are collectively editing.
///
/// One immutable value rather than six providers, because the steps are not
/// independent: screen 2.5's sub-cuisine rows are derived from screen 2.4's
/// region chips, and every screen needs the household id that screen 2.1
/// produced. Splitting that into separate providers would mean re-deriving
/// the same relationships at each read site.
///
/// Immutable per `coding-style.md`: [copyWith] returns a new value, and the
/// collections are handed out unmodifiable so a screen cannot mutate the
/// draft behind the controller's back.
class HouseholdWizardData {
  HouseholdWizardData({
    this.household,
    Set<MealType>? mealsEnabled,
    this.lunchStructure = LunchMealStructure.defaults,
    Set<CuisineRegion>? regions,
    Map<String, CuisineBias>? subCuisineWeights,
    Set<DietaryTag>? dietaryTags,
    List<String>? allergens,
    List<String>? skipIngredients,
  }) : mealsEnabled = Set<MealType>.unmodifiable(
         mealsEnabled ?? defaultMealsEnabled,
       ),
       regions = Set<CuisineRegion>.unmodifiable(
         regions ?? defaultCuisineRegions,
       ),
       subCuisineWeights = Map<String, CuisineBias>.unmodifiable(
         subCuisineWeights ??
             defaultWeightsFor(regions ?? defaultCuisineRegions),
       ),
       dietaryTags = Set<DietaryTag>.unmodifiable(
         dietaryTags ?? defaultDietaryTags,
       ),
       allergens = List<String>.unmodifiable(allergens ?? const <String>[]),
       skipIngredients = List<String>.unmodifiable(
         skipIngredients ?? const <String>[],
       );

  /// The household created by screen 2.1, or `null` before that step.
  ///
  /// It is the *whole* [Household], not just its id, because screen 2.7 needs
  /// the invite code the create mutation already returned — re-fetching it
  /// would be a second round trip against a possibly-cold Aurora instance for
  /// data the client is already holding.
  final Household? household;

  final Set<MealType> mealsEnabled;
  final LunchMealStructure lunchStructure;
  final Set<CuisineRegion> regions;

  /// Sub-cuisine key -> bias. Keys are always exactly the sub-cuisines of
  /// [regions]; the controller re-derives this whenever [regions] changes.
  final Map<String, CuisineBias> subCuisineWeights;

  final Set<DietaryTag> dietaryTags;
  final List<String> allergens;
  final List<String> skipIngredients;

  String? get householdId => household?.id;

  /// The code screen 2.7 displays. Treat as a credential — see [Household].
  String? get inviteCode => household?.inviteCode;

  bool get hasHousehold => household != null;

  /// The sub-cuisine rows screen 2.5 renders, in taxonomy order.
  List<SubCuisine> get visibleSubCuisines => subCuisinesForRegions(regions);

  HouseholdWizardData copyWith({
    Household? household,
    Set<MealType>? mealsEnabled,
    LunchMealStructure? lunchStructure,
    Set<CuisineRegion>? regions,
    Map<String, CuisineBias>? subCuisineWeights,
    Set<DietaryTag>? dietaryTags,
    List<String>? allergens,
    List<String>? skipIngredients,
  }) => HouseholdWizardData(
    household: household ?? this.household,
    mealsEnabled: mealsEnabled ?? this.mealsEnabled,
    lunchStructure: lunchStructure ?? this.lunchStructure,
    regions: regions ?? this.regions,
    subCuisineWeights: subCuisineWeights ?? this.subCuisineWeights,
    dietaryTags: dietaryTags ?? this.dietaryTags,
    allergens: allergens ?? this.allergens,
    skipIngredients: skipIngredients ?? this.skipIngredients,
  );

  /// `household` is summarised by id — `Household.toString` already omits the
  /// invite code for exactly this reason, and this must not undo that.
  @override
  String toString() =>
      'HouseholdWizardData(householdId: $householdId, '
      'meals: ${mealsEnabled.length}, regions: ${regions.length})';
}
