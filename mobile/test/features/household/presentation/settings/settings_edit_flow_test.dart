import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/household_settings_patch.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/presentation/create/cuisine_regions_screen.dart';
import 'package:mobile/features/household/presentation/create/dietary_allergens_screen.dart';
import 'package:mobile/features/household/presentation/create/meal_structure_screen.dart';
import 'package:mobile/features/household/presentation/create/slot_stepper.dart';
import 'package:mobile/features/household/presentation/create/wizard_flow.dart';
import 'package:mobile/features/household/presentation/create/wizard_step_scaffold.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/household_route_harness.dart';

const String _settingsRoute = '/household/household-1/settings';
const String _mealStructureRoute =
    '/household/household-1/settings/meal-structure';
const String _dietaryRoute = '/household/household-1/settings/dietary';

void main() {
  group('WizardFlowContext — the two flows differ where they should', () {
    test('create keeps the wizard chrome', () {
      const WizardFlowContext flow = WizardFlowContext.create();

      expect(flow.isEditing, isFalse);
      expect(flow.actionLabel, 'Continue');
      expect(flow.stepIndicator('2/4'), '2/4');
      expect(flow.destination(whenCreating: '/next'), '/next');
      expect(flow.backDestination(whenCreating: '/prev'), '/prev');
    });

    test('edit drops the step indicator and returns to the hub', () {
      const WizardFlowContext flow = WizardFlowContext.edit('household-1');

      expect(flow.isEditing, isTrue);
      expect(flow.actionLabel, 'Save');
      expect(
        flow.stepIndicator('2/4'),
        isNull,
        reason: 'a screen reached from Settings is not step 2 of anything',
      );
      expect(flow.destination(whenCreating: '/next'), _settingsRoute);
      expect(flow.backDestination(whenCreating: '/prev'), _settingsRoute);
    });
  });

  group('the edit routes reuse the wizard screens', () {
    testWidgets('meal structure renders the wizard screen, not a copy', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _mealStructureRoute);

      expect(find.byType(MealStructureScreen), findsOne);
    });

    testWidgets('dietary renders the wizard screen, not a copy', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _dietaryRoute);

      expect(find.byType(DietaryAllergensScreen), findsOne);
    });

    testWidgets('cuisine renders the wizard screen, not a copy', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        '/household/household-1/settings/cuisine',
      );

      expect(find.byType(CuisineRegionsScreen), findsOne);
    });

    testWidgets('the step indicator is suppressed in edit mode', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _mealStructureRoute);

      expect(find.byKey(WizardStepScaffold.stepIndicatorKey), findsNothing);
    });

    testWidgets('the action reads Save, not Continue', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _mealStructureRoute);

      expect(find.text('Save'), findsOne);
      expect(find.text('Continue'), findsNothing);
    });
  });

  group('the edit flow seeds the draft from the server', () {
    testWidgets(
      'the screen shows the stored lunch structure, not the wizard defaults',
      (WidgetTester tester) async {
        // `LunchMealStructure.defaults` is carb:2/sabziDal:2/accompaniment:1
        // — the same numbers as `testHouseholdSettings`'s own lunch json, so
        // routing that fixture through this screen couldn't have told a real
        // hydration from a silently-defaulted one apart (the bug this test
        // exists to catch: `HouseholdEditEntry.hydrateFrom` racing the
        // wizard notifier's async `build()`). Every value below is
        // deliberately off the defaults so a reverted fix fails this test.
        final HouseholdSettings distinguishingSettings = HouseholdSettings(
          householdId: testHouseholdWithMembers.settings.householdId,
          mealsEnabled: testHouseholdWithMembers.settings.mealsEnabled,
          mealStructureJson:
              '{"lunch":{"carb":4,"sabzi_dal":3,"accompaniment":2}}',
          cuisineTier1: testHouseholdWithMembers.settings.cuisineTier1,
          cuisineTier2WeightsJson:
              testHouseholdWithMembers.settings.cuisineTier2WeightsJson,
          dietaryTags: testHouseholdWithMembers.settings.dietaryTags,
          allergens: testHouseholdWithMembers.settings.allergens,
          skipIngredients: testHouseholdWithMembers.settings.skipIngredients,
        );
        final Household stored = Household(
          id: testHouseholdWithMembers.id,
          name: testHouseholdWithMembers.name,
          inviteCode: testHouseholdWithMembers.inviteCode,
          primaryUserId: testHouseholdWithMembers.primaryUserId,
          subscriptionStatus: testHouseholdWithMembers.subscriptionStatus,
          settings: distinguishingSettings,
          members: testHouseholdWithMembers.members,
        );
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          _mealStructureRoute,
          repository: FakeHouseholdRepository(
            result: testHousehold,
            fetchResult: stored,
            settingsResult: testHouseholdSettings,
          ),
        );

        expect(harness.repository.fetchCalls, contains('household-1'));
        // `valueKey` is on the Text widget itself, not an ancestor of it.
        Text valueText(MealSlot slot) =>
            tester.widget<Text>(find.byKey(SlotStepper.valueKey(slot)));
        expect(valueText(MealSlot.carb).data, '4');
        expect(valueText(MealSlot.sabziDal).data, '3');
        expect(valueText(MealSlot.accompaniment).data, '2');
      },
    );

    testWidgets(
      'Save sends a patch and returns to the hub rather than the next step',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          _mealStructureRoute,
        );

        await tester.tap(find.text('Save'));
        await tester.pumpAndSettle();

        expect(harness.repository.settingsCalls, hasLength(1));
        final HouseholdSettingsPatch patch =
            harness.repository.settingsCalls.single.patch;
        // Still one field per submit — the edit flow must not turn "patch per
        // step" into a whole-settings overwrite.
        expect(patch.fieldCount, 1);
        expect(patch.mealStructureJson, isNotNull);

        expect(location(harness.router), _settingsRoute);
      },
    );

    testWidgets('Back returns to the hub, not to the previous wizard step', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        _mealStructureRoute,
      );

      await tester.tap(find.text('‹'));
      await tester.pumpAndSettle();

      expect(location(harness.router), _settingsRoute);
    });
  });
}
