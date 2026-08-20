import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/presentation/create/meal_structure_screen.dart';
import 'package:mobile/features/household/presentation/create/slot_stepper.dart';
import 'package:mobile/features/household/presentation/create/wizard_step_scaffold.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/wizard_harness.dart';

Future<WizardHarness> _pump(
  WidgetTester tester, {
  FakeHouseholdRepository? repository,
}) => pumpWizardRoute(
  tester,
  AppRoutes.createHouseholdStructure,
  repository: repository,
);

String _valueOf(WidgetTester tester, MealSlot slot) =>
    tester.widget<Text>(find.byKey(SlotStepper.valueKey(slot))).data!;

Future<void> _tapPlus(WidgetTester tester, MealSlot slot) async {
  await tester.tap(find.byKey(SlotStepper.incrementKey(slot)));
  await tester.pumpAndSettle();
}

Future<void> _tapMinus(WidgetTester tester, MealSlot slot) async {
  await tester.tap(find.byKey(SlotStepper.decrementKey(slot)));
  await tester.pumpAndSettle();
}

void main() {
  group('MealStructureScreen — rendering', () {
    testWidgets('renders the wireframe copy and step 2/4', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(MealStructureScreen.heading), findsOne);
      expect(find.text(MealStructureScreen.hint), findsOne);
      expect(find.text(MealStructureScreen.stepIndicator), findsOne);
      expect(find.text(MealStructureScreen.dinnerNote), findsOne);
    });

    testWidgets('renders one stepper per slot at the wireframe defaults', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.byType(SlotStepper), findsExactly(3));
      expect(_valueOf(tester, MealSlot.carb), '2');
      expect(_valueOf(tester, MealSlot.sabziDal), '2');
      expect(_valueOf(tester, MealSlot.accompaniment), '1');
    });

    testWidgets('labels the slots as the design source draws them', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text('Carb'), findsOne);
      expect(find.text('Sabzi · Dal'), findsOne);
      expect(find.text('Accompaniment'), findsOne);
    });
  });

  group('MealStructureScreen — the steppers', () {
    testWidgets('+ and − move the count without a round trip', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await _tapPlus(tester, MealSlot.carb);
      expect(_valueOf(tester, MealSlot.carb), '3');

      await _tapMinus(tester, MealSlot.carb);
      await _tapMinus(tester, MealSlot.carb);
      expect(_valueOf(tester, MealSlot.carb), '1');

      expect(subject.repository.settingsCalls, isEmpty);
    });

    testWidgets('− is disabled at the floor, so 0 can never go negative', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await _tapMinus(tester, MealSlot.accompaniment);
      expect(_valueOf(tester, MealSlot.accompaniment), '0');

      // At the floor the control is inert rather than clamping silently — the
      // greyed button is the affordance that says "no lower".
      await _tapMinus(tester, MealSlot.accompaniment);
      expect(_valueOf(tester, MealSlot.accompaniment), '0');
    });

    testWidgets('+ stops at the server maximum of 10', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      for (int i = 0; i < 12; i++) {
        await _tapPlus(tester, MealSlot.carb);
      }

      expect(_valueOf(tester, MealSlot.carb), '10');
      expect(LunchMealStructure.maxSlots, 10);
    });

    testWidgets('changing one slot leaves the others alone', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await _tapPlus(tester, MealSlot.sabziDal);

      expect(_valueOf(tester, MealSlot.sabziDal), '3');
      expect(_valueOf(tester, MealSlot.carb), '2');
      expect(_valueOf(tester, MealSlot.accompaniment), '1');
    });
  });

  group('MealStructureScreen — continuing', () {
    testWidgets('Continue sends only the lunch-keyed mealStructure', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);
      await _tapPlus(tester, MealSlot.carb);

      await tester.tap(find.byKey(MealStructureScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(subject.repository.settingsCalls, hasLength(1));
      final patch = subject.repository.settingsCalls.single.patch;
      expect(patch.fieldCount, 1);
      expect(
        patch.mealStructureJson,
        '{"lunch":{"carb":3,"sabzi_dal":2,"accompaniment":1}}',
      );
      expect(patch.mealStructureJson, isNot(contains('dinner')));
    });

    testWidgets('advances to the cuisine screen on success', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await tester.tap(find.byKey(MealStructureScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(currentLocation(subject.router), AppRoutes.createHouseholdCuisine);
    });

    testWidgets('the draft survives a failure so the retry needs no re-entry', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsError: const InternalError('Something went wrong.'),
        ),
      );
      await _tapPlus(tester, MealSlot.carb);

      await tester.tap(find.byKey(MealStructureScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(WizardStepScaffold.errorKey), findsOne);
      expect(_valueOf(tester, MealSlot.carb), '3');
      expect(
        currentLocation(subject.router),
        AppRoutes.createHouseholdStructure,
      );
    });

    testWidgets('the steppers are inert while the patch is in flight', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsResult: testHouseholdSettings,
          delay: const Duration(milliseconds: 200),
        ),
      );

      await tester.tap(find.byKey(MealStructureScreen.continueButtonKey));
      await tester.pump();
      await tester.tap(
        find.byKey(SlotStepper.incrementKey(MealSlot.carb)),
        warnIfMissed: false,
      );
      await tester.pump();

      expect(_valueOf(tester, MealSlot.carb), '2');

      await tester.pumpAndSettle();
      expect(
        subject.container
            .read(householdWizardControllerProvider)
            .requireValue
            .lunchStructure
            .countFor(MealSlot.carb),
        2,
      );
    });
  });

  group('MealStructureScreen — back', () {
    testWidgets('back returns to the meals screen', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await tester.tap(find.text('‹'));
      await tester.pumpAndSettle();

      expect(currentLocation(subject.router), AppRoutes.createHouseholdMeals);
    });
  });
}
