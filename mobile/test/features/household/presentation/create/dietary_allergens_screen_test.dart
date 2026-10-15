import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/dietary_tag.dart';
import 'package:mobile/features/household/presentation/create/dietary_allergens_screen.dart';
import 'package:mobile/features/household/presentation/create/wizard_step_scaffold.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/p_chip.dart';
import 'package:mobile/shared/ui/components/p_top_bar.dart';

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

      expect(find.text('4/4'), findsOne);
      expect(find.text('EATING STYLE'), findsOne);
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
      // Sentence-case copy (§32.6), not the enum names.
      expect(find.text('Vegetarian'), findsOne);
      expect(find.text('Non-vegetarian'), findsOne);
      expect(find.text('Egg friendly'), findsOne);
      expect(find.text('Gluten free'), findsOne);
      expect(find.text('Dairy free'), findsOne);
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

  group('DietaryAllergensScreen — grouped chips (A7)', () {
    testWidgets('shows Eating style and Must also be groups in order', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text('EATING STYLE'), findsOne);
      expect(find.text('MUST ALSO BE'), findsOne);
      expect(find.text('Setup your Household'), findsOne);

      final double styleY = tester.getTopLeft(find.text('EATING STYLE')).dy;
      final double modifierY = tester.getTopLeft(find.text('MUST ALSO BE')).dy;
      final double veganY = tester
          .getTopLeft(
            find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.vegan)),
          )
          .dy;
      final double glutenY = tester
          .getTopLeft(
            find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.glutenFree)),
          )
          .dy;
      expect(styleY, lessThan(veganY));
      expect(veganY, lessThan(modifierY));
      expect(modifierY, lessThan(glutenY));
    });

    testWidgets('selected chips carry no tick glyph', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(PChip.selectedGlyph), findsNothing);
      await tester.tap(
        find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.glutenFree)),
      );
      await tester.pumpAndSettle();
      expect(find.text(PChip.selectedGlyph), findsNothing);
    });

    testWidgets('eating styles are multi-select (union)', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(
        find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.nonVeg)),
      );
      await tester.pumpAndSettle();

      expect(
        _draft(harness).dietaryTags,
        containsAll(<DietaryTag>[
          DietaryTag.veg,
          DietaryTag.eggetarian,
          DietaryTag.nonVeg,
        ]),
      );
    });

    testWidgets('Finish is disabled with an inline hint when no style', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);
      expect(find.byKey(DietaryAllergensScreen.styleHintKey), findsNothing);

      await tester.tap(
        find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.veg)),
      );
      await tester.tap(
        find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.eggetarian)),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.glutenFree)),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(DietaryAllergensScreen.styleHintKey), findsOne);
      expect(find.text(DietaryAllergensScreen.styleHint), findsOne);

      await tester.tap(
        find.byKey(DietaryAllergensScreen.finishButtonKey),
        warnIfMissed: false,
      );
      await tester.pumpAndSettle();
      expect(harness.repository.settingsCalls, isEmpty);
      expect(currentLocation(harness.router), AppRoutes.createHouseholdDietary);

      // Choosing a style re-enables Finish and clears the hint.
      await tester.tap(
        find.byKey(DietaryAllergensScreen.tagKey(DietaryTag.jain)),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(DietaryAllergensScreen.styleHintKey), findsNothing);

      await tester.tap(find.byKey(DietaryAllergensScreen.finishButtonKey));
      await tester.pumpAndSettle();
      expect(harness.repository.settingsCalls, hasLength(1));
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
          delay: const Duration(milliseconds: 200),
        ),
      );

      await tester.tap(find.byKey(DietaryAllergensScreen.finishButtonKey));
      await tester.pump();

      expect(find.text('Vegetarian'), findsOne);
      expect(find.byType(CircularProgressIndicator), findsOne);

      await tester.pumpAndSettle();
    });
  });

  group('DietaryAllergensScreen — back', () {
    testWidgets('back returns to the sub-cuisine screen', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(
        currentLocation(harness.router),
        AppRoutes.createHouseholdCuisineBias,
      );
    });
  });
}
