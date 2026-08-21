import 'dart:convert';

import '../domain/cuisine_taxonomy.dart';
import '../domain/dietary_tag.dart';
import '../domain/household.dart';
import '../domain/meal_structure.dart';
import '../domain/meal_type.dart';
import 'household_wizard_data.dart';

/// Turns a server [Household] back into an editable wizard draft.
///
/// The create wizard builds its draft from defaults and sends it upward. The
/// Settings edit flow needs the opposite direction: a screen opened from
/// Settings must show what is *currently stored*, not the wizard's defaults —
/// otherwise opening "Dietary tags" to add one would silently reset the other
/// five to factory settings the moment Save was pressed, because every patch
/// this wizard sends is a whole-list replacement.
///
/// ## Everything here degrades rather than throws
///
/// The inputs are the server's raw strings and two unvalidated `AWSJSON` blobs
/// (see `HouseholdSettings`' class doc — they are deliberately carried as
/// undecoded JSON text). All of it is decoded defensively:
///
///  * an enum name this build does not recognise is **dropped**, matching
///    `household_mapper.dart`'s degrade-a-field-never-fail-the-object rule;
///  * malformed or unexpectedly-shaped JSON falls back to the same defaults
///    the create wizard starts from;
///  * a slot count outside the server's `[0, 10]` is clamped by
///    `LunchMealStructure.withCount` rather than rejected.
///
/// Throwing instead would mean a single bad byte in one household's settings
/// row makes its Settings screens permanently unopenable — the one state from
/// which a user cannot recover by editing.
HouseholdWizardData wizardDataFromHousehold(Household household) {
  final HouseholdSettings settings = household.settings;

  return HouseholdWizardData(
    household: household,
    mealsEnabled: _decodeMeals(settings.mealsEnabled),
    lunchStructure: _decodeLunchStructure(settings.mealStructureJson),
    regions: _decodeRegions(settings.cuisineTier1),
    subCuisineWeights: _decodeWeights(
      settings.cuisineTier2WeightsJson,
      _decodeRegions(settings.cuisineTier1),
    ),
    dietaryTags: _decodeDietaryTags(settings.dietaryTags),
    allergens: List<String>.of(settings.allergens),
    skipIngredients: List<String>.of(settings.skipIngredients),
  );
}

/// Wire names to [MealType]s, dropping anything unrecognised.
///
/// An empty result is passed through as an empty set rather than replaced by
/// the defaults: a household that genuinely enabled no meals is a real state,
/// and "helpfully" re-enabling three would overwrite a deliberate choice.
Set<MealType> _decodeMeals(List<String> names) => names
    .map(
      (String name) => MealType.values
          .where((MealType meal) => meal.wireValue == name)
          .firstOrNull,
    )
    .nonNulls
    .toSet();

Set<CuisineRegion> _decodeRegions(List<String> names) => names
    .map(
      (String name) => CuisineRegion.values
          .where((CuisineRegion region) => region.wireValue == name)
          .firstOrNull,
    )
    .nonNulls
    .toSet();

Set<DietaryTag> _decodeDietaryTags(List<String> names) => names
    .map(
      (String name) => DietaryTag.values
          .where((DietaryTag tag) => tag.wireValue == name)
          .firstOrNull,
    )
    .nonNulls
    .toSet();

/// Reads the `lunch` key out of the `mealStructure` document.
///
/// Only `lunch` — matching what `LunchMealStructure.toJson` writes and what
/// wireframe screen 2.3 configures. A `dinner` key written by some later
/// screen is left strictly alone rather than read into this type and
/// round-tripped back as a lunch value.
LunchMealStructure _decodeLunchStructure(String json) {
  final Object? decoded = _tryDecode(json);
  if (decoded is! Map<String, dynamic>) {
    return LunchMealStructure.defaults;
  }

  final Object? lunch = decoded[MealType.lunch.wireValue];
  if (lunch is! Map<String, dynamic>) {
    return LunchMealStructure.defaults;
  }

  LunchMealStructure structure = LunchMealStructure.defaults;
  for (final MealSlot slot in MealSlot.values) {
    final Object? count = lunch[slot.wireKey];
    if (count is int) {
      // `withCount` clamps into the server's own `[0, 10]`.
      structure = structure.withCount(slot, count);
    }
  }
  return structure;
}

/// Reads the stored bias map, then re-derives it against [regions].
///
/// The re-derivation through `defaultWeightsFor` is what preserves the
/// invariant screen 2.5 depends on: the map's keys are *always* exactly the
/// sub-cuisines of the selected regions. A stored map can violate that — it
/// may hold residue from a region since removed, or be missing a region added
/// by a client that predates it — and screen 2.5 renders straight from the map,
/// so a violation would show the wrong rows.
Map<String, CuisineBias> _decodeWeights(
  String json,
  Set<CuisineRegion> regions,
) {
  final Object? decoded = _tryDecode(json);
  final Map<String, CuisineBias> stored = <String, CuisineBias>{};

  if (decoded is Map<String, dynamic>) {
    for (final MapEntry<String, dynamic> entry in decoded.entries) {
      final CuisineBias? bias = CuisineBias.values
          .where((CuisineBias value) => value.wireValue == entry.value)
          .firstOrNull;
      if (bias != null) {
        stored[entry.key] = bias;
      }
    }
  }

  return defaultWeightsFor(regions, existing: stored);
}

/// `jsonDecode` that answers `null` instead of throwing.
///
/// These two fields are `AWSJSON` blobs the client has never validated; a
/// `FormatException` escaping here would take down the whole Settings screen.
Object? _tryDecode(String json) {
  try {
    return jsonDecode(json);
  } on FormatException {
    return null;
  }
}
