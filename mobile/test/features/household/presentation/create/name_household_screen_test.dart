import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/household_name.dart';
import 'package:mobile/features/household/presentation/create/name_household_screen.dart';
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
  AppRoutes.createHouseholdName,
  repository: repository,
  // Screen 2.1 is the screen that *creates* the household, so it must start
  // without one.
  adoptHousehold: false,
);

Future<void> _enterName(WidgetTester tester, String name) async {
  await tester.enterText(find.byKey(NameHouseholdScreen.nameFieldKey), name);
  // `pumpAndSettle`, not `pump`: `InputDecorator` cross-fades its error line
  // out over several frames, so a single pump would still find the old text
  // on screen even though the state has already cleared.
  await tester.pumpAndSettle();
}

void main() {
  group('NameHouseholdScreen — rendering', () {
    testWidgets('renders the wireframe copy', (WidgetTester tester) async {
      await _pump(tester);

      expect(find.text('New household'), findsOne);
      expect(find.text(NameHouseholdScreen.fieldLabel), findsOne);
      expect(find.text(NameHouseholdScreen.fieldHint), findsOne);
      expect(find.text(NameHouseholdScreen.fieldHelper), findsOne);
      expect(find.byKey(NameHouseholdScreen.continueButtonKey), findsOne);
    });

    testWidgets('carries no step indicator — it is outside the 4 steps', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.byKey(WizardStepScaffold.stepIndicatorKey), findsNothing);
    });

    testWidgets('shows no error line before anything is attempted', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.byKey(WizardStepScaffold.errorKey), findsNothing);
    });
  });

  group('NameHouseholdScreen — client-side validation', () {
    testWidgets('an empty name renders an inline error and calls nothing', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('name must not be empty'), findsOne);
      expect(subject.repository.calls, isEmpty);
    });

    testWidgets('an over-long name renders an inline error', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await _enterName(tester, 'x' * (maxHouseholdNameLength + 1));
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(
        find.text('name must be at most $maxHouseholdNameLength characters'),
        findsOne,
      );
      expect(subject.repository.calls, isEmpty);
    });

    testWidgets('the inline error clears once the name is corrected', (
      WidgetTester tester,
    ) async {
      await _pump(tester);
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pumpAndSettle();

      await _enterName(tester, 'Kulkarni Kitchen');

      expect(find.text('name must not be empty'), findsNothing);
    });
  });

  group('NameHouseholdScreen — creating', () {
    testWidgets('a valid name dispatches createHousehold', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await _enterName(tester, 'Kulkarni Kitchen');
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(subject.repository.calls, <String>['Kulkarni Kitchen']);
    });

    testWidgets('hands the created household to the wizard and advances', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(tester);

      await _enterName(tester, 'Kulkarni Kitchen');
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(currentLocation(subject.router), AppRoutes.createHouseholdMeals);
      expect(
        subject.container
            .read(householdWizardControllerProvider)
            .requireValue
            .householdId,
        'household-1',
      );
    });
  });

  group('NameHouseholdScreen — the Aurora cold start', () {
    testWidgets('the loading state is legible, not a frozen button', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          delay: const Duration(milliseconds: 200),
        ),
      );

      await _enterName(tester, 'Kulkarni Kitchen');
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pump();

      expect(find.text(NameHouseholdScreen.continueLoadingLabel), findsOne);
      expect(find.byKey(NameHouseholdScreen.coldStartHintKey), findsOne);

      await tester.pumpAndSettle();
    });

    testWidgets('the field is inert while the create is in flight', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          delay: const Duration(milliseconds: 200),
        ),
      );
      await _enterName(tester, 'Kulkarni Kitchen');
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pump();

      final TextField field = tester.widget<TextField>(
        find.descendant(
          of: find.byKey(NameHouseholdScreen.nameFieldKey),
          matching: find.byType(TextField),
        ),
      );
      expect(field.enabled, isFalse);

      await tester.pumpAndSettle();
    });
  });

  group('NameHouseholdScreen — server errors', () {
    testWidgets('renders the server message and stays put', (
      WidgetTester tester,
    ) async {
      final subject = await _pump(
        tester,
        repository: FakeHouseholdRepository(
          error: const ValidationError(
            'name must not contain control characters',
          ),
        ),
      );

      await _enterName(tester, 'Kulkarni Kitchen');
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(WizardStepScaffold.errorKey), findsOne);
      expect(find.text('name must not contain control characters'), findsOne);
      expect(currentLocation(subject.router), AppRoutes.createHouseholdName);
    });

    testWidgets('a rate-limit surfaces its own copy, not a generic one', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeHouseholdRepository(
          error: const RateLimitedError('Too many households today.'),
        ),
      );

      await _enterName(tester, 'Kulkarni Kitchen');
      await tester.tap(find.byKey(NameHouseholdScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('Too many households today.'), findsOne);
    });
  });
}
