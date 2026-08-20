import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/cuisine_taxonomy.dart';
import 'package:mobile/features/household/presentation/create/cuisine_sub_bias_screen.dart';
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
  AppRoutes.createHouseholdCuisineBias,
  repository: repository,
);

/// Drops every region that has documented sub-cuisines, leaving the empty
/// state — reachable in the real app by unticking North and South Indian.
Future<void> _clearRegionsWithSubCuisines(
  WidgetTester tester,
  WizardHarness harness,
) async {
  final HouseholdWizardController controller = harness.container.read(
    householdWizardControllerProvider.notifier,
  );
  controller
    ..toggleRegion(CuisineRegion.northIndian)
    ..toggleRegion(CuisineRegion.southIndian);
  await tester.pumpAndSettle();
}

void main() {
  group('CuisineSubBiasScreen — rendering', () {
    testWidgets('stays on step 3/4 — it is the second frame of one step', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(CuisineSubBiasScreen.stepIndicator), findsOne);
      expect(find.text('3/4'), findsOne);
    });

    testWidgets('renders a section per selected region that has sub-cuisines', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text('UNDER NORTH INDIAN'), findsOne);
      expect(find.text('UNDER SOUTH INDIAN'), findsOne);
      // Pan-India is selected by default but has no documented sub-cuisines,
      // so it contributes no section rather than an empty one.
      expect(find.text('UNDER PAN-INDIA'), findsNothing);
    });

    testWidgets('renders the PRD sub-cuisines under North Indian', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      for (final SubCuisine sub in subCuisinesOf(CuisineRegion.northIndian)) {
        expect(find.text(sub.displayLabel), findsOne);
      }
    });

    testWidgets('every sub-cuisine offers Less / Same / More', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(
        find.byKey(CuisineSubBiasScreen.biasKey('punjabi', CuisineBias.less)),
        findsOne,
      );
      expect(
        find.byKey(CuisineSubBiasScreen.biasKey('punjabi', CuisineBias.normal)),
        findsOne,
      );
      expect(
        find.byKey(CuisineSubBiasScreen.biasKey('punjabi', CuisineBias.more)),
        findsOne,
      );
    });

    testWidgets('the middle option reads "Same", never "normal"', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text('Same'), findsWidgets);
      expect(find.text('normal'), findsNothing);
    });
  });

  group('CuisineSubBiasScreen — the empty case', () {
    testWidgets(
      'regions with no documented sub-cuisines get an empty state with a way '
      'back, not a blank screen',
      (WidgetTester tester) async {
        final harness = await _pump(tester);

        await _clearRegionsWithSubCuisines(tester, harness);

        expect(find.byKey(CuisineSubBiasScreen.emptyStateKey), findsOne);
        expect(find.text('Nothing to fine-tune'), findsOne);
      },
    );

    testWidgets('the empty state can get back to the regions screen', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);
      await _clearRegionsWithSubCuisines(tester, harness);

      await tester.tap(find.text('Back to regions'));
      await tester.pumpAndSettle();

      expect(currentLocation(harness.router), AppRoutes.createHouseholdCuisine);
    });
  });

  group('CuisineSubBiasScreen — choosing a bias', () {
    testWidgets('tapping More records it without a round trip', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(
        find.byKey(CuisineSubBiasScreen.biasKey('punjabi', CuisineBias.more)),
      );
      await tester.pumpAndSettle();

      expect(
        harness.container
            .read(householdWizardControllerProvider)
            .requireValue
            .subCuisineWeights['punjabi'],
        CuisineBias.more,
      );
      expect(harness.repository.settingsCalls, isEmpty);
    });

    testWidgets('choosing one sub-cuisine leaves its neighbours at Same', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(
        find.byKey(CuisineSubBiasScreen.biasKey('punjabi', CuisineBias.less)),
      );
      await tester.pumpAndSettle();

      final Map<String, CuisineBias> weights = harness.container
          .read(householdWizardControllerProvider)
          .requireValue
          .subCuisineWeights;
      expect(weights['punjabi'], CuisineBias.less);
      expect(weights['marathi'], CuisineBias.normal);
    });
  });

  group('CuisineSubBiasScreen — continuing', () {
    testWidgets(
      'Continue sends only cuisineTier2Weights, with the server spelling',
      (WidgetTester tester) async {
        final harness = await _pump(tester);
        await tester.tap(
          find.byKey(CuisineSubBiasScreen.biasKey('punjabi', CuisineBias.more)),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(CuisineSubBiasScreen.continueButtonKey));
        await tester.pumpAndSettle();

        expect(harness.repository.settingsCalls, hasLength(1));
        final patch = harness.repository.settingsCalls.single.patch;
        expect(patch.fieldCount, 1);
        expect(patch.cuisineTier2WeightsJson, contains('"punjabi":"more"'));
        expect(patch.cuisineTier2WeightsJson, contains('"tamil":"normal"'));
        expect(patch.cuisineTier2WeightsJson, isNot(contains('same')));
        expect(
          currentLocation(harness.router),
          AppRoutes.createHouseholdDietary,
        );
      },
    );

    testWidgets('an error renders inline and blocks the advance', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsError: const ValidationError(
            'cuisineTier2Weights must have at most 20 keys',
          ),
        ),
      );

      await tester.tap(find.byKey(CuisineSubBiasScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(WizardStepScaffold.errorKey), findsOne);
      expect(
        find.text('cuisineTier2Weights must have at most 20 keys'),
        findsOne,
      );
      expect(
        currentLocation(harness.router),
        AppRoutes.createHouseholdCuisineBias,
      );
    });

    testWidgets('the rows stay on screen while the patch is in flight', (
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

      await tester.tap(find.byKey(CuisineSubBiasScreen.continueButtonKey));
      await tester.pump();

      expect(find.text('Punjabi'), findsOne);
      expect(find.byType(CircularProgressIndicator), findsOne);

      await tester.pumpAndSettle();
    });
  });

  group('CuisineSubBiasScreen — back', () {
    testWidgets('back returns to the regions screen', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(find.text('‹'));
      await tester.pumpAndSettle();

      expect(currentLocation(harness.router), AppRoutes.createHouseholdCuisine);
    });
  });
}
