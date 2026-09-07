import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/domain/meal_instance_plan.dart';
import 'package:mobile/features/menu/domain/meal_slot_plan.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';

/// A minimal, deliberately-unfilled [PlannedSlot] — these tests only care
/// about grouping, not about item content, so every fixture slot is empty
/// unless a test specifically needs a filled one (see the Lunch
/// filled/empty-preservation test below).
PlannedSlot _slot(MealType mealType, RecipeRole role) =>
    PlannedSlot(mealType: mealType, slotRole: role);

void main() {
  group('groupSlotsByMealInstance', () {
    test(
      'a full four-meal day groups into exactly four groups, in Breakfast → Lunch → Snacks → Dinner order',
      () {
        final List<PlannedSlot> slots = <PlannedSlot>[
          _slot(MealType.breakfast, RecipeRole.breakfast),
          _slot(MealType.lunch, RecipeRole.carb),
          _slot(MealType.lunch, RecipeRole.sabziDal),
          _slot(MealType.lunch, RecipeRole.accompaniment),
          _slot(MealType.snacks, RecipeRole.snack),
          _slot(MealType.dinner, RecipeRole.carb),
          _slot(MealType.dinner, RecipeRole.sabziDal),
          _slot(MealType.dinner, RecipeRole.accompaniment),
        ];

        final List<MealInstanceGroup> groups = groupSlotsByMealInstance(
          slots,
        );

        expect(groups, hasLength(4));
        expect(groups.map((MealInstanceGroup g) => g.mealType), <MealType>[
          MealType.breakfast,
          MealType.lunch,
          MealType.snacks,
          MealType.dinner,
        ]);
      },
    );

    test(
      'a household with Snacks disabled produces exactly three groups, with no Snacks group synthesized',
      () {
        // Mirrors plannedSlotsForDay's own output shape when `snacks` is
        // absent from mealsEnabled: no slot at all carries mealType.snacks,
        // so nothing here should invent an empty group for it.
        final List<PlannedSlot> slots = <PlannedSlot>[
          _slot(MealType.breakfast, RecipeRole.breakfast),
          _slot(MealType.lunch, RecipeRole.carb),
          _slot(MealType.dinner, RecipeRole.carb),
        ];

        final List<MealInstanceGroup> groups = groupSlotsByMealInstance(
          slots,
        );

        expect(groups, hasLength(3));
        expect(
          groups.any((MealInstanceGroup g) => g.mealType == MealType.snacks),
          isFalse,
        );
      },
    );

    test(
      'a household with Lunch disabled but Dinner enabled produces groups for the remaining meal types, still in relative order',
      () {
        final List<PlannedSlot> slots = <PlannedSlot>[
          _slot(MealType.breakfast, RecipeRole.breakfast),
          _slot(MealType.snacks, RecipeRole.snack),
          _slot(MealType.dinner, RecipeRole.carb),
          _slot(MealType.dinner, RecipeRole.sabziDal),
        ];

        final List<MealInstanceGroup> groups = groupSlotsByMealInstance(
          slots,
        );

        expect(groups.map((MealInstanceGroup g) => g.mealType), <MealType>[
          MealType.breakfast,
          MealType.snacks,
          MealType.dinner,
        ]);
      },
    );

    test(
      'within a Lunch group, sub-slot order and multiplicity (carb:2, sabzi_dal:3, accompaniment:2) are preserved exactly as they arrived, filled/empty status included',
      () {
        // Deliberately built to look like a real plannedSlotsForDay output
        // for a household configured {carb: 2, sabzi_dal: 3,
        // accompaniment: 2}: carb block first, then sabzi/dal, then
        // accompaniment, with one filled slot planted mid-block to prove
        // isFilled survives the regroup untouched.
        final List<PlannedSlot> lunchSlots = <PlannedSlot>[
          _slot(MealType.lunch, RecipeRole.carb),
          _slot(MealType.lunch, RecipeRole.carb),
          _slot(MealType.lunch, RecipeRole.sabziDal),
          _slot(MealType.lunch, RecipeRole.sabziDal),
          _slot(MealType.lunch, RecipeRole.sabziDal),
          _slot(MealType.lunch, RecipeRole.accompaniment),
          _slot(MealType.lunch, RecipeRole.accompaniment),
        ];

        final List<MealInstanceGroup> groups = groupSlotsByMealInstance(
          lunchSlots,
        );

        expect(groups, hasLength(1));
        final MealInstanceGroup lunchGroup = groups.single;
        expect(lunchGroup.mealType, MealType.lunch);
        expect(lunchGroup.slots, hasLength(7));
        expect(
          lunchGroup.slots.map((PlannedSlot s) => s.slotRole),
          <RecipeRole>[
            RecipeRole.carb,
            RecipeRole.carb,
            RecipeRole.sabziDal,
            RecipeRole.sabziDal,
            RecipeRole.sabziDal,
            RecipeRole.accompaniment,
            RecipeRole.accompaniment,
          ],
        );
        // Identity-preservation: the exact same PlannedSlot instances come
        // back out, in the same order — a regroup, not a rebuild.
        expect(lunchGroup.slots, orderedEquals(lunchSlots));
      },
    );

    test('an empty input list produces zero groups, not four empty ones', () {
      final List<MealInstanceGroup> groups = groupSlotsByMealInstance(
        const <PlannedSlot>[],
      );
      expect(groups, isEmpty);
    });

    test(
      'groupSlotsByMealInstance takes only a List<PlannedSlot> — no HouseholdSettings or other settings-shaped argument (the enforcement is the signature itself)',
      () {
        // Calling it correctly here, and everywhere else in this file,
        // with exactly one positional List<PlannedSlot> argument IS the
        // structural assertion — if a settings parameter were ever added
        // (required or not), every call site in this file would need to
        // change to keep compiling.
        final List<MealInstanceGroup> groups = groupSlotsByMealInstance(
          <PlannedSlot>[_slot(MealType.breakfast, RecipeRole.breakfast)],
        );
        expect(groups, hasLength(1));
      },
    );
  });
}
