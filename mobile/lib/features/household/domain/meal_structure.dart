import 'dart:convert';

import 'meal_type.dart';

/// The three slot types one meal is composed of.
///
/// The keys are fixed by the server: `api/src/validation/updateHouseholdSettings.ts`
/// requires **all three** of `carb`, `sabzi_dal` and `accompaniment` on every
/// meal-type key present in `mealStructure`, each an integer in `[0, 10]`.
/// There is no partial entry, which is why [LunchMealStructure] carries all
/// three as non-nullable fields rather than a sparse map.
enum MealSlot {
  carb,
  sabziDal,
  accompaniment;

  /// The JSON key the server validates against. `sabzi_dal` is the one that
  /// differs from [name] — the wire is snake_case, Dart is lower-camel, and
  /// this getter is the only place that knows.
  String get wireKey => switch (this) {
    MealSlot.carb => 'carb',
    MealSlot.sabziDal => 'sabzi_dal',
    MealSlot.accompaniment => 'accompaniment',
  };

  /// Wireframe screen 2.3 row labels. The middle-dot in "Sabzi · Dal" is the
  /// design source's own glyph, not a separator this code invented.
  String get displayLabel => switch (this) {
    MealSlot.carb => 'Carb',
    MealSlot.sabziDal => 'Sabzi · Dal',
    MealSlot.accompaniment => 'Accompaniment',
  };
}

/// How many slots of each type a lunch may hold.
///
/// ## Why lunch only
///
/// `mealStructure` is an `AWSJSON` map keyed by meal type, so it *could*
/// carry `breakfast`, `lunch`, `snacks` and `dinner` at once. Wireframe screen
/// 2.3 configures lunch and says so in its own italic footnote — *"Dinner uses
/// the same structure — edit separately later."* Silently writing a `dinner`
/// key here would contradict the copy on the screen and quietly overwrite a
/// value the user believes they have not touched yet, so [toJson] emits
/// exactly one key.
///
/// Immutable: [withCount] returns a new value rather than mutating.
class LunchMealStructure {
  const LunchMealStructure({
    required this.carb,
    required this.sabziDal,
    required this.accompaniment,
  });

  /// Wireframe screen 2.3 starting values.
  static const LunchMealStructure defaults = LunchMealStructure(
    carb: 2,
    sabziDal: 2,
    accompaniment: 1,
  );

  /// Mirrors the server's `z.number().int().min(0)`.
  static const int minSlots = 0;

  /// Mirrors the server's `.max(10)`.
  static const int maxSlots = 10;

  final int carb;
  final int sabziDal;
  final int accompaniment;

  /// The count for [slot].
  int countFor(MealSlot slot) => switch (slot) {
    MealSlot.carb => carb,
    MealSlot.sabziDal => sabziDal,
    MealSlot.accompaniment => accompaniment,
  };

  /// A copy with [slot] set to [count], **clamped** into `[minSlots, maxSlots]`.
  ///
  /// Clamping rather than rejecting is deliberate: the only caller is a
  /// `+`/`−` stepper, where "one past the end" is a tap, not a mistake worth
  /// an error message. The server's identical bound is still the authority —
  /// this just means the stepper can never build a patch the server would
  /// refuse.
  LunchMealStructure withCount(MealSlot slot, int count) {
    final int clamped = count.clamp(minSlots, maxSlots);
    return LunchMealStructure(
      carb: slot == MealSlot.carb ? clamped : carb,
      sabziDal: slot == MealSlot.sabziDal ? clamped : sabziDal,
      accompaniment: slot == MealSlot.accompaniment ? clamped : accompaniment,
    );
  }

  /// The decoded `mealStructure` document: one meal-type key, three slot keys.
  Map<String, Object?> toJson() => <String, Object?>{
    MealType.lunch.wireValue: <String, Object?>{
      MealSlot.carb.wireKey: carb,
      MealSlot.sabziDal.wireKey: sabziDal,
      MealSlot.accompaniment.wireKey: accompaniment,
    },
  };

  /// [toJson] as the JSON **string** `AWSJSON` actually is on the wire.
  ///
  /// See `build.yaml`'s `type_overrides` note and
  /// `api/src/mappers/household.ts`: this scalar is `JSON.stringify`'d in both
  /// directions, never a nested object.
  String toWireJson() => jsonEncode(toJson());

  @override
  String toString() =>
      'LunchMealStructure(carb: $carb, sabziDal: $sabziDal, '
      'accompaniment: $accompaniment)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is LunchMealStructure &&
          other.carb == carb &&
          other.sabziDal == sabziDal &&
          other.accompaniment == accompaniment;

  @override
  int get hashCode => Object.hash(carb, sabziDal, accompaniment);
}
