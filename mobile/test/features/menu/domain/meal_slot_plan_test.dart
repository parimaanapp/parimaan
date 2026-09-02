import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/menu/domain/meal_slot_plan.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';

import '../../../support/menu_fixtures.dart';

HouseholdSettings _settings({
  List<String> mealsEnabled = const <String>['breakfast', 'lunch', 'dinner'],
  String? mealStructureJson,
}) => HouseholdSettings(
  householdId: 'household-1',
  mealsEnabled: mealsEnabled,
  mealStructureJson: mealStructureJson ?? '{"lunch":{"carb":1,"sabzi_dal":2,"accompaniment":1},"dinner":{"carb":1,"sabzi_dal":2,"accompaniment":1}}',
  cuisineTier1: const <String>[],
  cuisineTier2WeightsJson: '{}',
  dietaryTags: const <String>[],
  allergens: const <String>[],
  skipIngredients: const <String>[],
);

void main() {
  group('plannedSlotsForDay', () {
    // The exact "four toggles, no transposition" rigor E2E_MVP_PLAN.md
    // §15.3 S5's own RED spec asks for: every meal type checked
    // independently, not one sampled and assumed representative.
    for (final MapEntry<String, int> entry in <String, int>{
      'lunch': 4,
      'dinner': 4,
      'breakfast': 0,
      'snacks': 0,
    }.entries) {
      test(
        'a household with mealsEnabled: [lunch, dinner] and default mealStructure renders exactly ${entry.value} slots for ${entry.key}',
        () {
          final HouseholdSettings settings = _settings(
            mealsEnabled: const <String>['lunch', 'dinner'],
          );
          final List<PlannedSlot> slots = plannedSlotsForDay(
            settings,
            const <MenuItem>[],
          );
          final int countForMealType = slots
              .where((PlannedSlot s) => s.mealType.wireValue == entry.key)
              .length;
          expect(countForMealType, entry.value);
        },
      );
    }

    test('default lunch structure is exactly 1 carb + 2 sabzi_dal + 1 accompaniment', () {
      final HouseholdSettings settings = _settings(
        mealsEnabled: const <String>['lunch'],
      );
      final List<PlannedSlot> slots = plannedSlotsForDay(
        settings,
        const <MenuItem>[],
      );

      expect(
        slots.where((PlannedSlot s) => s.slotRole == RecipeRole.carb),
        hasLength(1),
      );
      expect(
        slots.where((PlannedSlot s) => s.slotRole == RecipeRole.sabziDal),
        hasLength(2),
      );
      expect(
        slots.where((PlannedSlot s) => s.slotRole == RecipeRole.accompaniment),
        hasLength(1),
      );
    });

    test('breakfast/snacks each render exactly one slot, role-agnostic', () {
      final HouseholdSettings settings = _settings(
        mealsEnabled: const <String>['breakfast', 'snacks'],
      );
      final List<PlannedSlot> slots = plannedSlotsForDay(
        settings,
        const <MenuItem>[],
      );
      expect(slots, hasLength(2));
      expect(slots.every((PlannedSlot s) => !s.isFilled), isTrue);
    });

    test('a filled slot carries its MenuItem; an unmatched slot at the same triple stays empty', () {
      final HouseholdSettings settings = _settings(
        mealsEnabled: const <String>['lunch'],
      );
      final MenuItem item = testMenuItem; // lunch, sabziDal
      final List<PlannedSlot> slots = plannedSlotsForDay(settings, <MenuItem>[
        item,
      ]);

      final List<PlannedSlot> sabziDalSlots = slots
          .where((PlannedSlot s) => s.slotRole == RecipeRole.sabziDal)
          .toList();
      expect(sabziDalSlots, hasLength(2));
      expect(sabziDalSlots.where((PlannedSlot s) => s.isFilled), hasLength(1));
      expect(
        sabziDalSlots.singleWhere((PlannedSlot s) => s.isFilled).item,
        item,
      );
    });

    test('a disabled meal type contributes zero slots, even with items placed on it (a stale/inconsistent state)', () {
      final HouseholdSettings settings = _settings(
        mealsEnabled: const <String>['lunch'],
      );
      // testMenuItem is a lunch/sabziDal item, so it's still filtered out
      // once we ask only about breakfast (never in mealsEnabled here).
      final List<PlannedSlot> slots = plannedSlotsForDay(settings, <MenuItem>[
        testMenuItem,
      ]);
      expect(
        slots.where((PlannedSlot s) => s.mealType.wireValue == 'breakfast'),
        isEmpty,
      );
    });

    test('a slot beyond the configured cap is never rendered as addable — a lowered cap with matching items still stops at the count', () {
      final HouseholdSettings settings = _settings(
        mealsEnabled: const <String>['lunch'],
        mealStructureJson:
            '{"lunch":{"carb":0,"sabzi_dal":1,"accompaniment":0}}',
      );
      final List<PlannedSlot> slots = plannedSlotsForDay(
        settings,
        const <MenuItem>[],
      );
      expect(slots, hasLength(1));
      expect(slots.single.slotRole, RecipeRole.sabziDal);
    });

    test('a malformed mealStructure document renders ZERO addable slots — mirrors the server\'s own fail-closed getMealSlotCap, never a "reasonable default"', () {
      final HouseholdSettings settings = _settings(
        mealsEnabled: const <String>['lunch'],
        mealStructureJson: 'not valid json',
      );
      final List<PlannedSlot> slots = plannedSlotsForDay(
        settings,
        const <MenuItem>[],
      );
      expect(slots, isEmpty);
    });

    test('a lunch/dinner key present but missing a specific role also caps that role at zero', () {
      final HouseholdSettings settings = _settings(
        mealsEnabled: const <String>['lunch'],
        mealStructureJson: '{"lunch":{"carb":1}}',
      );
      final List<PlannedSlot> slots = plannedSlotsForDay(
        settings,
        const <MenuItem>[],
      );
      expect(slots, hasLength(1));
      expect(slots.single.slotRole, RecipeRole.carb);
    });
  });
}
