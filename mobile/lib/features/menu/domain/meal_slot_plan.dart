import 'dart:convert';

import 'package:collection/collection.dart';

import '../../household/domain/household.dart';
import '../../household/domain/meal_structure.dart';
import '../../household/domain/meal_type.dart';
import '../../recipes/domain/recipe_role.dart';
import 'menu.dart';

/// One instance of a slot on the Weekly plan grid for one day — either
/// filled with a placed [MenuItem], or empty (a tappable "+" affordance,
/// PRD §6's locked no-drag-and-drop pattern).
class PlannedSlot {
  const PlannedSlot({
    required this.mealType,
    required this.slotRole,
    this.item,
  });

  final MealType mealType;
  final RecipeRole slotRole;

  /// `null` means this slot is empty and addable.
  final MenuItem? item;

  bool get isFilled => item != null;

  @override
  String toString() =>
      'PlannedSlot(mealType: ${mealType.name}, slotRole: ${slotRole.name}, isFilled: $isFilled)';
}

/// Computes every slot instance for one day, honoring the household's own
/// configuration (E2E_MVP_PLAN.md §15.3 S5 — the gate this function exists
/// for: "Week-view honors meal structure config"):
///
///  - A meal type absent from `settings.mealsEnabled` contributes zero slots.
///  - `breakfast`/`snacks` contribute exactly ONE slot each, role-agnostic —
///    single-recipe meals with no per-role structure, mirroring `addMenuItem`'s
///    own server-side cap reasoning (`api/src/domain/mealStructure.ts`) so the
///    two sides can never silently drift apart.
///  - `lunch`/`dinner` contribute one slot instance per unit of count in
///    `mealStructure[mealType][role]`, for each of carb/sabziDal/accompaniment
///    — and, matching the server's `getMealSlotCap` EXACTLY (not just in the
///    well-formed case), a missing or malformed entry caps at ZERO, never a
///    "reasonable default." A household's `mealStructure` document always
///    genuinely has real counts once created (`insertDefaultSettings` writes
///    `DEFAULT_MEAL_STRUCTURE` explicitly, and there is no mutation that can
///    write a partial one today), so this path is not normally reachable —
///    but rendering an addable "+" for a slot the server would reject with
///    `ConflictError` on the very next `addMenuItem` call is a worse failure
///    mode than rendering zero slots for a day this decoder couldn't parse,
///    the same "fail closed, not open" reasoning `getMealSlotCap`'s own
///    comment gives.
///
/// [itemsForDay] must already be filtered to the day being rendered —
/// `Menu.itemsForDay`. When more items exist for a `(mealType, role)` pair
/// than the configured count allows (only reachable if a household lowers
/// its `mealStructure` after items were already placed under the old, wider
/// one — `addMenuItem` itself enforces the cap going forward), the excess
/// items are simply not rendered as slots here; that reconciliation is out
/// of scope for this read-only grid.
List<PlannedSlot> plannedSlotsForDay(
  HouseholdSettings settings,
  List<MenuItem> itemsForDay,
) {
  final Map<String, Map<String, int>> structure = _decodeMealStructure(
    settings.mealStructureJson,
  );
  final List<PlannedSlot> slots = <PlannedSlot>[];

  for (final MealType mealType in MealType.values) {
    if (!settings.mealsEnabled.contains(mealType.wireValue)) {
      continue;
    }

    if (mealType == MealType.breakfast || mealType == MealType.snacks) {
      slots.add(
        _singleItemSlot(
          mealType,
          mealType == MealType.breakfast
              ? RecipeRole.breakfast
              : RecipeRole.snack,
          itemsForDay,
        ),
      );
      continue;
    }

    final Map<String, int>? roleCounts = structure[mealType.wireValue];
    for (final MealSlot slot in MealSlot.values) {
      final RecipeRole role = _recipeRoleFor(slot);
      final int count = roleCounts?[slot.wireKey] ?? 0;
      final List<MenuItem> matching = itemsForDay
          .where(
            (MenuItem item) =>
                item.mealSlot == mealType.wireValue && item.slotRole == role,
          )
          .toList(growable: false);
      for (int i = 0; i < count; i++) {
        slots.add(
          PlannedSlot(
            mealType: mealType,
            slotRole: role,
            item: i < matching.length ? matching[i] : null,
          ),
        );
      }
    }
  }

  return slots;
}

PlannedSlot _singleItemSlot(
  MealType mealType,
  RecipeRole fallbackRole,
  List<MenuItem> itemsForDay,
) {
  final MenuItem? existing = itemsForDay
      .where((MenuItem item) => item.mealSlot == mealType.wireValue)
      .firstOrNull;
  return PlannedSlot(
    mealType: mealType,
    slotRole: existing?.slotRole ?? fallbackRole,
    item: existing,
  );
}

RecipeRole _recipeRoleFor(MealSlot slot) => switch (slot) {
  MealSlot.carb => RecipeRole.carb,
  MealSlot.sabziDal => RecipeRole.sabziDal,
  MealSlot.accompaniment => RecipeRole.accompaniment,
};

/// Decodes `mealStructure` defensively — a malformed document (this is
/// `AWSJSON`, no DB-level shape guarantee beyond "valid JSON") falls back to
/// an empty map, which makes every `lunch`/`dinner` role count 0 (see
/// `plannedSlotsForDay`'s own doc for why zero, not a "reasonable default")
/// rather than throwing.
Map<String, Map<String, int>> _decodeMealStructure(String json) {
  final Object? decoded = _tryDecode(json);
  if (decoded is! Map<String, dynamic>) {
    return const <String, Map<String, int>>{};
  }

  final Map<String, Map<String, int>> result = <String, Map<String, int>>{};
  for (final MapEntry<String, dynamic> entry in decoded.entries) {
    final Object? value = entry.value;
    if (value is! Map<String, dynamic>) {
      continue;
    }
    final Map<String, int> roleCounts = <String, int>{};
    for (final MapEntry<String, dynamic> roleEntry in value.entries) {
      final Object? count = roleEntry.value;
      if (count is int) {
        roleCounts[roleEntry.key] = count;
      }
    }
    result[entry.key] = roleCounts;
  }
  return result;
}

Object? _tryDecode(String json) {
  try {
    return jsonDecode(json);
  } on FormatException {
    return null;
  }
}
