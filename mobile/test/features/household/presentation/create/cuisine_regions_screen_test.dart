import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/cuisine_taxonomy.dart';
import 'package:mobile/features/household/presentation/create/cuisine_regions_screen.dart';
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
  AppRoutes.createHouseholdCuisine,
  repository: repository,
);

Set<CuisineRegion> _regions(WizardHarness harness) => harness.container
    .read(householdWizardControllerProvider)
    .requireValue
    .regions;

void main() {
  group('CuisineRegionsScreen — rendering', () {
    testWidgets('renders the wireframe copy and step 3/4', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(CuisineRegionsScreen.heading), findsOne);
      expect(find.text(CuisineRegionsScreen.hint), findsOne);
      expect(find.text(CuisineRegionsScreen.stepIndicator), findsOne);
      expect(find.text(CuisineRegionsScreen.unlockNote), findsOne);
    });

    testWidgets('renders one chip per schema CuisineTier1 value', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      for (final CuisineRegion region in CuisineRegion.values) {
        expect(find.byKey(CuisineRegionsScreen.chipKey(region)), findsOne);
        expect(find.text(region.displayLabel), findsOne);
      }
    });

    testWidgets(
      'renders no East chip — the wireframe draws one but the schema has no '
      'such enum value to send',
      (WidgetTester tester) async {
        await _pump(tester);

        expect(find.text('East'), findsNothing);
        expect(find.byType(Chip), findsNothing);
      },
    );

    testWidgets('the first three regions start selected', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      expect(_regions(harness), defaultCuisineRegions);
    });
  });

  group('CuisineRegionsScreen — selecting', () {
    testWidgets('tapping a chip toggles it off without a round trip', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(
        find.byKey(CuisineRegionsScreen.chipKey(CuisineRegion.northIndian)),
      );
      await tester.pumpAndSettle();

      expect(_regions(harness), isNot(contains(CuisineRegion.northIndian)));
      expect(harness.repository.settingsCalls, isEmpty);
    });

    testWidgets('tapping an unselected chip turns it on', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(
        find.byKey(CuisineRegionsScreen.chipKey(CuisineRegion.continental)),
      );
      await tester.pumpAndSettle();

      expect(_regions(harness), contains(CuisineRegion.continental));
    });

    testWidgets('dropping a region drops its sub-cuisine biases too', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(
        find.byKey(CuisineRegionsScreen.chipKey(CuisineRegion.northIndian)),
      );
      await tester.pumpAndSettle();

      expect(
        harness.container
            .read(householdWizardControllerProvider)
            .requireValue
            .subCuisineWeights
            .keys,
        isNot(contains('punjabi')),
      );
    });
  });

  group('CuisineRegionsScreen — continuing', () {
    testWidgets('Continue sends only cuisineTier1 and advances', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(find.byKey(CuisineRegionsScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(harness.repository.settingsCalls, hasLength(1));
      final patch = harness.repository.settingsCalls.single.patch;
      expect(patch.fieldCount, 1);
      expect(patch.cuisineTier1, <CuisineRegion>[
        CuisineRegion.northIndian,
        CuisineRegion.southIndian,
        CuisineRegion.panIndia,
      ]);
      expect(
        currentLocation(harness.router),
        AppRoutes.createHouseholdCuisineBias,
      );
    });

    testWidgets('an error renders inline and blocks the advance', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(
        tester,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          settingsError: const ValidationError('cuisineTier1 is invalid'),
        ),
      );

      await tester.tap(find.byKey(CuisineRegionsScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(WizardStepScaffold.errorKey), findsOne);
      expect(find.text('cuisineTier1 is invalid'), findsOne);
      expect(currentLocation(harness.router), AppRoutes.createHouseholdCuisine);
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

      await tester.tap(find.byKey(CuisineRegionsScreen.continueButtonKey));
      await tester.pump();

      expect(find.text(CuisineRegion.northIndian.displayLabel), findsOne);
      expect(find.byType(CircularProgressIndicator), findsOne);

      await tester.pumpAndSettle();
    });
  });

  group('CuisineRegionsScreen — back', () {
    testWidgets('back returns to the lunch structure', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(find.text('‹'));
      await tester.pumpAndSettle();

      expect(
        currentLocation(harness.router),
        AppRoutes.createHouseholdStructure,
      );
    });
  });
}
