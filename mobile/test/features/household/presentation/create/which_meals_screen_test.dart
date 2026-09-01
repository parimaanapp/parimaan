import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/household/presentation/create/which_meals_screen.dart';
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
  AppRoutes.createHouseholdMeals,
  repository: repository,
);

void main() {
  group('WhichMealsScreen — rendering', () {
    testWidgets('renders the wireframe copy and the step indicator', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(WhichMealsScreen.heading), findsOne);
      expect(find.text(WhichMealsScreen.hint), findsOne);
      expect(find.text(WhichMealsScreen.stepIndicator), findsOne);
    });

    testWidgets('renders one card per wizard meal, with its description', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      for (final MealType meal in wizardMealTypes) {
        expect(find.byKey(WhichMealsScreen.toggleKey(meal)), findsOne);
        expect(find.text(meal.displayLabel), findsOne);
        expect(find.text(meal.description), findsOne);
      }
    });

    testWidgets(
      'offers no Snacks toggle — the wireframe draws three, not four',
      (WidgetTester tester) async {
        await _pump(tester);

        expect(
          find.byKey(WhichMealsScreen.toggleKey(MealType.snacks)),
          findsNothing,
        );
        expect(find.text('Snacks'), findsNothing);
      },
    );

    testWidgets('all three meals start on', (WidgetTester tester) async {
      final subject = await _pump(tester);

      expect(
        subject.container
            .read(householdWizardControllerProvider)
            .requireValue
            .mealsEnabled,
        defaultMealsEnabled,
      );
    });

    testWidgets('shows no error line before anything is attempted', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.byKey(WizardStepScaffold.errorKey), findsNothing);
    });
  });

  group('WhichMealsScreen — toggling', () {
    testWidgets('tapping a card toggles it without a round trip', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await tester.tap(
        find.byKey(WhichMealsScreen.toggleKey(MealType.breakfast)),
      );
      await tester.pumpAndSettle();

      expect(
        subject.container
            .read(householdWizardControllerProvider)
            .requireValue
            .mealsEnabled,
        isNot(contains(MealType.breakfast)),
      );
      expect(subject.repository.settingsCalls, isEmpty);
    });
  });

  group('WhichMealsScreen — continuing', () {
    testWidgets('Continue submits only mealsEnabled and advances', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await tester.tap(find.byKey(WhichMealsScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(subject.repository.settingsCalls, hasLength(1));
      expect(subject.repository.settingsCalls.single.patch.fieldCount, 1);
      expect(
        currentLocation(subject.router),
        AppRoutes.createHouseholdStructure,
      );
    });

    testWidgets('the in-flight state shows a spinner, not a frozen screen', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          delay: const Duration(milliseconds: 200),
        ),
      );

      await tester.tap(find.byKey(WhichMealsScreen.continueButtonKey));
      await tester.pump();

      // The toggles are still on screen underneath the spinner — the draft
      // survives the loading state rather than the screen blanking out.
      expect(find.text(MealType.breakfast.displayLabel), findsOne);
      expect(find.byType(CircularProgressIndicator), findsOne);

      await tester.pumpAndSettle();
    });
  });

  group('WhichMealsScreen — server errors', () {
    testWidgets('renders the error inline and does not advance', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsError: const RateLimitedError('Slow down a moment.'),
        ),
      );

      await tester.tap(find.byKey(WhichMealsScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(WizardStepScaffold.errorKey), findsOne);
      expect(find.text('Slow down a moment.'), findsOne);
      expect(currentLocation(subject.router), AppRoutes.createHouseholdMeals);
    });

    testWidgets('FORBIDDEN gets setup-specific copy, not the server wording', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsError: const ForbiddenError('not a member of household'),
        ),
      );

      await tester.tap(find.byKey(WhichMealsScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('not a member of household'), findsNothing);
      expect(
        find.text(
          "You're no longer a member of this household. Start setup again.",
        ),
        findsOne,
      );
    });

    testWidgets('editing after a failure clears the stale message', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsError: const InternalError('Something went wrong.'),
        ),
      );
      await tester.tap(find.byKey(WhichMealsScreen.continueButtonKey));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(WhichMealsScreen.toggleKey(MealType.lunch)));
      await tester.pumpAndSettle();

      expect(find.byKey(WizardStepScaffold.errorKey), findsNothing);
    });
  });

  group('WhichMealsScreen — back', () {
    testWidgets('back returns to the name screen', (WidgetTester tester) async {
      final subject = await _pump(tester);

      await tester.tap(find.text('‹'));
      await tester.pumpAndSettle();

      expect(currentLocation(subject.router), AppRoutes.createHouseholdName);
    });
  });
}
