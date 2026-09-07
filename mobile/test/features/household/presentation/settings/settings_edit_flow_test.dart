import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/household_settings_patch.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/household/presentation/create/cuisine_regions_screen.dart';
import 'package:mobile/features/household/presentation/create/dietary_allergens_screen.dart';
import 'package:mobile/features/household/presentation/create/meal_structure_screen.dart';
import 'package:mobile/features/household/presentation/create/slot_stepper.dart';
import 'package:mobile/features/household/presentation/create/which_meals_screen.dart';
import 'package:mobile/features/household/presentation/create/wizard_flow.dart';
import 'package:mobile/features/household/presentation/create/wizard_step_scaffold.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/household_route_harness.dart';

const String _settingsRoute = '/household/household-1/settings';
const String _mealStructureRoute =
    '/household/household-1/settings/meal-structure';
const String _dietaryRoute = '/household/household-1/settings/dietary';
const String _mealsRoute = '/household/household-1/settings/meals';

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

    testWidgets('meals renders the wizard screen, not a copy', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _mealsRoute);

      expect(find.byType(WhichMealsScreen), findsOne);
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

  group(
    '"Meals to plan" — mealsEnabled editable for all four meal types '
    '(W13 S3, E2E_MVP_PLAN.md §19.3 S3)',
    () {
      testWidgets('the edit screen offers four toggles, including Snacks', (
        WidgetTester tester,
      ) async {
        await pumpHouseholdRoute(tester, _mealsRoute);

        for (final MealType meal in MealType.values) {
          expect(find.byKey(WhichMealsScreen.toggleKey(meal)), findsOne);
        }
        expect(find.text(MealType.snacks.displayLabel), findsOne);
      });

      testWidgets(
        'enabling Snacks and saving produces a mealsEnabled patch '
        'containing snacks',
        (WidgetTester tester) async {
          final HouseholdHarness harness = await pumpHouseholdRoute(
            tester,
            _mealsRoute,
          );

          await tester.tap(
            find.byKey(WhichMealsScreen.toggleKey(MealType.snacks)),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Save'));
          await tester.pumpAndSettle();

          expect(harness.repository.settingsCalls, hasLength(1));
          final HouseholdSettingsPatch patch =
              harness.repository.settingsCalls.single.patch;
          expect(patch.fieldCount, 1);
          expect(patch.mealsEnabled, contains(MealType.snacks));
          expect(location(harness.router), _settingsRoute);
        },
      );

      testWidgets(
        'a household that had Snacks cleared by the three-toggle wizard can '
        'turn it back on from Settings, and it persists across a reload — '
        'the end-to-end statement of the gap this slice closes',
        (WidgetTester tester) async {
          // `testHouseholdWithMembers.settings.mealsEnabled` is
          // breakfast/lunch/dinner — exactly what the three-toggle create
          // wizard produces (`wizardMealTypes`'s own doc: a meal the user
          // was never shown is a meal they did not opt into). Snacks is
          // absent, matching the gap this slice closes.
          final FakeHouseholdRepository repo = FakeHouseholdRepository(
            result: testHousehold,
            fetchResult: testHouseholdWithMembers,
          );
          final HouseholdHarness harness = await pumpHouseholdRoute(
            tester,
            _mealsRoute,
            repository: repo,
          );

          expect(
            harness.container
                .read(householdWizardControllerProvider)
                .requireValue
                .mealsEnabled,
            isNot(contains(MealType.snacks)),
          );

          await tester.tap(
            find.byKey(WhichMealsScreen.toggleKey(MealType.snacks)),
          );
          await tester.pumpAndSettle();

          // The server's returned settings row is not folded back into the
          // wizard draft (`household_wizard_controller.dart`'s own doc) — a
          // real round trip is read back through a fresh fetch instead, the
          // same one `HouseholdSyncScope` fires on route entry. Simulating
          // that here is what makes this an end-to-end persistence
          // assertion rather than a re-check of local draft state.
          repo.fetchResult = Household(
            id: testHouseholdWithMembers.id,
            name: testHouseholdWithMembers.name,
            inviteCode: testHouseholdWithMembers.inviteCode,
            primaryUserId: testHouseholdWithMembers.primaryUserId,
            subscriptionStatus: testHouseholdWithMembers.subscriptionStatus,
            settings: HouseholdSettings(
              householdId: testHouseholdWithMembers.settings.householdId,
              mealsEnabled: const <String>['breakfast', 'lunch', 'dinner', 'snacks'],
              mealStructureJson:
                  testHouseholdWithMembers.settings.mealStructureJson,
              cuisineTier1: testHouseholdWithMembers.settings.cuisineTier1,
              cuisineTier2WeightsJson:
                  testHouseholdWithMembers.settings.cuisineTier2WeightsJson,
              dietaryTags: testHouseholdWithMembers.settings.dietaryTags,
              allergens: testHouseholdWithMembers.settings.allergens,
              skipIngredients: testHouseholdWithMembers.settings.skipIngredients,
            ),
            members: testHouseholdWithMembers.members,
          );

          await tester.tap(find.text('Save'));
          await tester.pumpAndSettle();

          expect(location(harness.router), _settingsRoute);

          // The "reload" itself — the same `CurrentHouseholdController.refresh()`
          // a real app fires on route re-entry or app foreground
          // (`HouseholdSyncPolicy`'s own doc) and the settings hub's
          // `HouseholdSyncScope` binds to. Called directly here, awaited,
          // rather than relying on that policy's own initState-time trigger
          // firing within this test's synthetic navigation — this is an
          // end-to-end assertion about `mealsEnabled` surviving a refetch,
          // not an assertion about that policy's internal timing.
          await harness.container
              .read(currentHouseholdControllerProvider('household-1').notifier)
              .refresh();

          expect(
            harness.container
                .read(currentHouseholdControllerProvider('household-1'))
                .requireValue
                .settings
                .mealsEnabled,
            contains('snacks'),
          );
        },
      );

      testWidgets(
        'toggling every meal off and saving surfaces the server "at least '
        'one meal" VALIDATION error inline — asserted, not changed, in the '
        'edit flow too',
        (WidgetTester tester) async {
          final HouseholdHarness harness = await pumpHouseholdRoute(
            tester,
            _mealsRoute,
            repository: FakeHouseholdRepository(
              result: testHousehold,
              fetchResult: testHouseholdWithMembers,
              settingsError: const ValidationError('mealsEnabled is invalid'),
            ),
          );

          // `testHouseholdWithMembers.settings.mealsEnabled` starts as
          // breakfast/lunch/dinner (Snacks already off) — turning those
          // three off, and leaving Snacks alone, is what reaches the empty
          // set.
          for (final MealType meal in wizardMealTypes) {
            await tester.tap(find.byKey(WhichMealsScreen.toggleKey(meal)));
            await tester.pumpAndSettle();
          }

          await tester.tap(find.text('Save'));
          await tester.pumpAndSettle();

          expect(find.byKey(WizardStepScaffold.errorKey), findsOne);
          expect(find.text('mealsEnabled is invalid'), findsOne);
          expect(location(harness.router), _mealsRoute);
        },
      );
    },
  );
}
