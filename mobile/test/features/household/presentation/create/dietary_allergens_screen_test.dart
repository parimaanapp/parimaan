import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/dietary_tag.dart';
import 'package:mobile/features/household/presentation/create/dietary_allergens_screen.dart';
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
  AppRoutes.createHouseholdDietary,
  repository: repository,
);

HouseholdWizardData _draft(WizardHarness harness) =>
    harness.container.read(householdWizardControllerProvider).requireValue;

Future<void> _addAllergen(WidgetTester tester, String value) async {
  await tester.enterText(
    find.byKey(DietaryAllergensScreen.allergenFieldKey),
    value,
  );
  await tester.pumpAndSettle();
  await tester.tap(
    find.descendant(
      of: find.byKey(DietaryAllergensScreen.allergenFieldKey),
      matching: find.text('Add'),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('DietaryAllergensScreen — rendering', () {
    testWidgets('renders the three wireframe sections at step 4/4', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(DietaryAllergensScreen.stepIndicator), findsOne);
      expect(find.text('DIETARY'), findsOne);
      expect(find.text('ALLERGENS'), findsOne);
      expect(find.text('SKIP INGREDIENTS'), findsOne);
    });

    testWidgets('renders one chip per DietaryTag, with the wireframe copy', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      for (final DietaryTag tag in DietaryTag.values) {
        expect(find.byKey(DietaryAllergensScreen.tagKey(tag)), findsOne);
      }
      // The two labels that are not their enum names.
      expect(find.text('egg-friendly'), findsOne);
      expect(find.text('GF'), findsOne);
      expect(find.text('eggetarian'), findsNothing);
      expect(find.text('gluten_free'), findsNothing);
    });

    testWidgets('the last step says "Finish setup", not "Continue"', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(DietaryAllergensScreen.finishLabel), findsOne);
      expect(find.text('Continue'), findsNothing);
    });

    testWidgets('veg and egg-friendly start selected', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      expect(_draft(harness).dietaryTags, defaultDietaryTags);
    });
  });

  group('DietaryAllergensScreen — free-text lists', () {
    testWidgets('an allergen can be added and shows as a removable chip', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await _addAllergen(tester, 'peanut');

      expect(_draft(harness).allergens, <String>['peanut']);
      expect(
        find.byKey(DietaryAllergensScreen.allergenChipKey('peanut')),
        findsOne,
      );
    });

    testWidgets('a blank entry is ignored', (WidgetTester tester) async {
      final harness = await _pump(tester);

      await _addAllergen(tester, '   ');

      expect(_draft(harness).allergens, isEmpty);
    });

    testWidgets('a duplicate is not added twice', (WidgetTester tester) async {
      final harness = await _pump(tester);

      await _addAllergen(tester, 'peanut');
      await _addAllergen(tester, 'peanut');

      expect(_draft(harness).allergens, <String>['peanut']);
    });

    testWidgets('the × removes an allergen', (WidgetTester tester) async {
      final harness = await _pump(tester);
      await _addAllergen(tester, 'peanut');

      await tester.tap(
        find.descendant(
          of: find.byKey(DietaryAllergensScreen.allergenChipKey('peanut')),
          matching: find.text('×'),
        ),
      );
      await tester.pumpAndSettle();

      expect(_draft(harness).allergens, isEmpty);
    });

    testWidgets('skip ingredients are a separate list from allergens', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.enterText(
        find.byKey(DietaryAllergensScreen.skipFieldKey),
        'mustard oil',
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byKey(DietaryAllergensScreen.skipFieldKey),
          matching: find.text('Add'),
        ),
      );
      await tester.pumpAndSettle();

      expect(_draft(harness).skipIngredients, <String>['mustard oil']);
      expect(_draft(harness).allergens, isEmpty);
    });
  });

  group('DietaryAllergensScreen — dietary chips', () {
    testWidgets('tapping a chip toggles it without a round trip', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(
        find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.jain)),
      );
      await tester.pumpAndSettle();

      expect(_draft(harness).dietaryTags, contains(DietaryTag.jain));
      expect(harness.repository.settingsCalls, isEmpty);
    });
  });

  group('DietaryAllergensScreen — finishing', () {
    testWidgets('Finish setup sends the three fields this step owns', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);
      await _addAllergen(tester, 'peanut');

      await tester.tap(find.byKey(DietaryAllergensScreen.finishButtonKey));
      await tester.pumpAndSettle();

      expect(harness.repository.settingsCalls, hasLength(1));
      final patch = harness.repository.settingsCalls.single.patch;
      expect(patch.fieldCount, 3);
      expect(patch.dietaryTags, <DietaryTag>[
        DietaryTag.veg,
        DietaryTag.eggetarian,
      ]);
      expect(patch.allergens, <String>['peanut']);
      expect(patch.skipIngredients, isEmpty);
    });

    testWidgets('a successful finish lands on the invite code screen', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(find.byKey(DietaryAllergensScreen.finishButtonKey));
      await tester.pumpAndSettle();

      expect(currentLocation(harness.router), AppRoutes.createHouseholdInvite);
    });

    testWidgets('an error renders inline and keeps the user here', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsError: const ValidationError('allergens must be strings'),
        ),
      );

      await tester.tap(find.byKey(DietaryAllergensScreen.finishButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(WizardStepScaffold.errorKey), findsOne);
      expect(find.text('allergens must be strings'), findsOne);
      expect(currentLocation(harness.router), AppRoutes.createHouseholdDietary);
    });

    testWidgets('the chips stay on screen while the patch is in flight', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsResult: testHouseholdSettings,
          delay: const Duration(milliseconds: 200),
        ),
      );

      await tester.tap(find.byKey(DietaryAllergensScreen.finishButtonKey));
      await tester.pump();

      expect(find.text('veg'), findsOne);
      expect(find.byType(CircularProgressIndicator), findsOne);

      await tester.pumpAndSettle();
    });
  });

  group('DietaryAllergensScreen — back', () {
    testWidgets('back returns to the sub-cuisine screen', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(find.text('‹'));
      await tester.pumpAndSettle();

      expect(
        currentLocation(harness.router),
        AppRoutes.createHouseholdCuisineBias,
      );
    });
  });
}
