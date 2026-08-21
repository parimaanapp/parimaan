import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/presentation/settings/delete_household_dialog.dart';
import 'package:mobile/features/household/presentation/settings/settings_hub_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/household_route_harness.dart';

const String _route = '/household/household-1/settings';

/// Opens the Settings hub as the primary and taps Delete household.
Future<HouseholdHarness> _openDialog(
  WidgetTester tester, {
  FakeHouseholdRepository? repository,
}) async {
  final HouseholdHarness harness = await pumpHouseholdRoute(
    tester,
    _route,
    repository: repository,
  );

  await tester.dragUntilVisible(
    find.byKey(SettingsHubScreen.deleteRowKey),
    find.byType(Scrollable).first,
    const Offset(0, -80),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(SettingsHubScreen.deleteRowKey));
  await tester.pumpAndSettle();

  return harness;
}

bool _confirmEnabled(WidgetTester tester) =>
    tester
        .widget<PButton>(find.byKey(DeleteHouseholdDialogKeys.confirmKey))
        .onPressed !=
    null;

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byKey(DeleteHouseholdDialogKeys.inputKey), text);
  await tester.pumpAndSettle();
}

void main() {
  group('DeleteHouseholdDialog — the exact-match gate', () {
    testWidgets('opens disabled, naming the household to type', (
      WidgetTester tester,
    ) async {
      await _openDialog(tester);

      expect(find.text(DeleteHouseholdDialogKeys.heading), findsOne);
      expect(find.text('Type Kulkarni Kitchen to confirm.'), findsOne);
      expect(_confirmEnabled(tester), isFalse);
    });

    testWidgets('enables only on a byte-for-byte match', (
      WidgetTester tester,
    ) async {
      await _openDialog(tester);

      await _type(tester, 'Kulkarni Kitchen');

      expect(_confirmEnabled(tester), isTrue);
    });

    testWidgets(
      'stays disabled for a case variation — the server compares with !==',
      (WidgetTester tester) async {
        await _openDialog(tester);

        await _type(tester, 'kulkarni kitchen');

        expect(
          _confirmEnabled(tester),
          isFalse,
          reason:
              'showing a green light on a near-miss is the most dangerous '
              'thing this dialog could do',
        );
      },
    );

    testWidgets('stays disabled for surrounding whitespace — no trimming', (
      WidgetTester tester,
    ) async {
      await _openDialog(tester);

      await _type(tester, '  Kulkarni Kitchen  ');

      expect(_confirmEnabled(tester), isFalse);
    });

    testWidgets('stays disabled for a partial name', (
      WidgetTester tester,
    ) async {
      await _openDialog(tester);

      await _type(tester, 'Kulkarni');

      expect(_confirmEnabled(tester), isFalse);
    });
  });

  group('DeleteHouseholdDialog — deleting', () {
    testWidgets('sends the typed name verbatim and leaves the household', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await _openDialog(tester);

      await _type(tester, 'Kulkarni Kitchen');
      await tester.tap(find.byKey(DeleteHouseholdDialogKeys.confirmKey));
      await tester.pumpAndSettle();

      expect(harness.repository.deleteCalls, hasLength(1));
      expect(harness.repository.deleteCalls.single.householdId, 'household-1');
      expect(
        harness.repository.deleteCalls.single.confirmationName,
        'Kulkarni Kitchen',
      );
      expect(location(harness.router), AppRoutes.firstRun);
    });

    testWidgets('Cancel closes without deleting anything', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await _openDialog(tester);

      await tester.tap(find.byKey(DeleteHouseholdDialogKeys.cancelKey));
      await tester.pumpAndSettle();

      expect(harness.repository.deleteCalls, isEmpty);
      expect(location(harness.router), _route);
      expect(find.byKey(DeleteHouseholdDialogKeys.confirmKey), findsNothing);
    });

    testWidgets(
      'a server rejection keeps the dialog open with its message — the '
      'household still exists',
      (WidgetTester tester) async {
        await _openDialog(
          tester,
          repository: FakeHouseholdRepository(
            fetchResult: testHouseholdWithMembers,
            deleteError: const ValidationError(
              'confirmationName must exactly match the household name.',
            ),
          ),
        );

        await _type(tester, 'Kulkarni Kitchen');
        await tester.tap(find.byKey(DeleteHouseholdDialogKeys.confirmKey));
        await tester.pumpAndSettle();

        expect(find.byKey(DeleteHouseholdDialogKeys.confirmKey), findsOne);
        expect(find.byKey(DeleteHouseholdDialogKeys.errorKey), findsOne);
      },
    );
  });
}
