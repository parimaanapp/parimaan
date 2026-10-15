import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/household/presentation/create/cuisine_regions_screen.dart';
import 'package:mobile/features/household/presentation/create/cuisine_sub_bias_screen.dart';
import 'package:mobile/features/household/presentation/create/dietary_allergens_screen.dart';
import 'package:mobile/features/household/presentation/create/meal_structure_screen.dart';
import 'package:mobile/features/household/presentation/create/slot_stepper.dart';
import 'package:mobile/features/household/presentation/create/which_meals_screen.dart';

import '../../../../support/wizard_harness.dart';

Future<void> _tapKey(WidgetTester tester, Key key) async {
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

void _expectStep(WizardHarness h, String route, String indicator) {
  expect(currentLocation(h.router), route);
  expect(find.text(indicator), findsOne);
}

void main() {
  group('setup wizard — whole flow through the real router', () {
    testWidgets('dinner toggle ON walks four steps with snacks persisted', (
      WidgetTester tester,
    ) async {
      final h = await pumpWizardRoute(tester, AppRoutes.createHouseholdMeals);
      _expectStep(h, AppRoutes.createHouseholdMeals, '1/4');
      expect(find.text('Setup your Household'), findsOne);

      await _tapKey(tester, WhichMealsScreen.toggleKey(MealType.snacks));
      await _tapKey(tester, WhichMealsScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdStructure, '2/4');
      await _tapKey(tester, MealStructureScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdCuisine, '3/4');
      await _tapKey(tester, CuisineRegionsScreen.continueButtonKey);

      expect(currentLocation(h.router), AppRoutes.createHouseholdCuisineBias);
      expect(find.text('3/4'), findsOne);
      await _tapKey(tester, CuisineSubBiasScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdDietary, '4/4');
      await _tapKey(tester, DietaryAllergensScreen.finishButtonKey);

      expect(currentLocation(h.router), AppRoutes.createHouseholdInvite);
      expect(
        h.repository.settingsCalls.first.patch.mealsEnabled,
        contains(MealType.snacks),
      );
    });

    testWidgets('dinner toggle OFF walks five steps including dinner page', (
      WidgetTester tester,
    ) async {
      final h = await pumpWizardRoute(tester, AppRoutes.createHouseholdMeals);
      _expectStep(h, AppRoutes.createHouseholdMeals, '1/4');
      await _tapKey(tester, WhichMealsScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdStructure, '2/4');
      await _tapKey(tester, MealStructureScreen.sameAsLunchKey);
      expect(find.text('2/5'), findsOne);
      await _tapKey(tester, MealStructureScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdDinnerStructure, '3/5');
      await tester.tap(find.byKey(SlotStepper.incrementKey(MealSlot.carb)));
      await tester.pumpAndSettle();
      await _tapKey(tester, MealStructureScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdCuisine, '4/5');
      await _tapKey(tester, CuisineRegionsScreen.continueButtonKey);
      await _tapKey(tester, CuisineSubBiasScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdDietary, '5/5');
      await _tapKey(tester, DietaryAllergensScreen.finishButtonKey);

      expect(currentLocation(h.router), AppRoutes.createHouseholdInvite);
      // meals, lunch, dinner, cuisine regions, bias, dietary.
      expect(h.repository.settingsCalls, hasLength(6));
      expect(
        h.repository.settingsCalls[2].patch.mealStructureJson,
        '{"dinner":{"carb":3,"sabzi_dal":2,"accompaniment":1}}',
      );
    });

    testWidgets('lunch disabled goes meals -> dinner page -> cuisine', (
      WidgetTester tester,
    ) async {
      final h = await pumpWizardRoute(tester, AppRoutes.createHouseholdMeals);
      await _tapKey(tester, WhichMealsScreen.toggleKey(MealType.lunch));
      await _tapKey(tester, WhichMealsScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdDinnerStructure, '2/4');
      expect(find.byKey(MealStructureScreen.sameAsLunchKey), findsNothing);
      await _tapKey(tester, MealStructureScreen.continueButtonKey);

      _expectStep(h, AppRoutes.createHouseholdCuisine, '3/4');
    });

    testWidgets('Back from cuisine returns to the dinner page when OFF', (
      WidgetTester tester,
    ) async {
      final h = await pumpWizardRoute(tester, AppRoutes.createHouseholdMeals);
      await _tapKey(tester, WhichMealsScreen.continueButtonKey);
      await _tapKey(tester, MealStructureScreen.sameAsLunchKey);
      await _tapKey(tester, MealStructureScreen.continueButtonKey);
      await _tapKey(tester, MealStructureScreen.continueButtonKey);
      expect(currentLocation(h.router), AppRoutes.createHouseholdCuisine);

      await tester.tap(find.bySemanticsLabel('Back to the dinner structure'));
      await tester.pumpAndSettle();

      expect(
        currentLocation(h.router),
        AppRoutes.createHouseholdDinnerStructure,
      );
    });
  });
}
