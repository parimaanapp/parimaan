import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/invite_code.dart';
import 'package:mobile/features/household/presentation/join/enter_code_screen.dart';
import 'package:mobile/features/household/presentation/join/invite_code_field.dart';
import 'package:mobile/features/household/presentation/household_error_copy.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/household_route_harness.dart';

Future<void> _type(WidgetTester tester, String code) async {
  await tester.enterText(find.byKey(InviteCodeField.hiddenFieldKey), code);
  await tester.pumpAndSettle();
}

void main() {
  group('EnterCodeScreen — chrome', () {
    testWidgets('renders the title, heading and the literal wireframe hint', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      expect(find.text(EnterCodeScreen.topBarTitle), findsOne);
      expect(find.text(EnterCodeScreen.heading), findsOne);
      expect(
        find.text('6 characters. Not case-sensitive. No zeros, O, I, or L.'),
        findsOne,
      );
    });

    testWidgets('renders exactly six character boxes', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      for (int index = 0; index < inviteCodeLength; index++) {
        expect(find.byKey(InviteCodeField.boxKey(index)), findsOne);
      }
      expect(
        find.byKey(InviteCodeField.boxKey(inviteCodeLength)),
        findsNothing,
      );
    });
  });

  group('EnterCodeScreen — the Join button gates on code shape', () {
    testWidgets('is disabled with an empty field', (WidgetTester tester) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      final PButtonFinder button = PButtonFinder(tester);
      expect(button.isEnabled, isFalse);
    });

    testWidgets('stays disabled at five characters', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      await _type(tester, 'K4M9P');

      expect(PButtonFinder(tester).isEnabled, isFalse);
    });

    testWidgets('enables at exactly six', (WidgetTester tester) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      await _type(tester, 'K4M9PQ');

      expect(PButtonFinder(tester).isEnabled, isTrue);
    });
  });

  group('EnterCodeScreen — input filtering', () {
    testWidgets('uppercases as the user types', (WidgetTester tester) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      await _type(tester, 'k4m9pq');

      // What is shown must equal what will be sent — see the field's doc.
      expect(find.text('K'), findsOne);
      expect(find.text('k'), findsNothing);
    });

    testWidgets(
      'drops keystrokes outside the generator alphabet, so a typo never '
      'becomes a code',
      (WidgetTester tester) async {
        final harness = await pumpHouseholdRoute(
          tester,
          AppRoutes.joinHousehold,
        );

        // 0, O, I and L are excluded by `api/src/domain/inviteCode.ts`.
        await _type(tester, 'K0OIL4');
        await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
        await tester.pumpAndSettle();

        // Only K and 4 survived — two characters, so Join was never enabled.
        expect(harness.repository.joinCalls, isEmpty);
      },
    );
  });

  group('EnterCodeScreen — joining', () {
    testWidgets('Join calls the mutation with the typed code', (
      WidgetTester tester,
    ) async {
      final harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.joinHousehold,
        repository: FakeHouseholdRepository(
          joinResult: testHouseholdWithMembers,
        ),
      );

      await _type(tester, 'K4M9PQ');
      await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
      await tester.pumpAndSettle();

      expect(harness.repository.joinCalls, <String>['K4M9PQ']);
    });

    testWidgets('a successful join advances to the confirm screen', (
      WidgetTester tester,
    ) async {
      final harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.joinHousehold,
        repository: FakeHouseholdRepository(
          joinResult: testHouseholdWithMembers,
        ),
      );

      await _type(tester, 'K4M9PQ');
      await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.joinConfirm);
    });

    testWidgets(
      'HOUSEHOLD_FULL routes to the Full screen, not the error line',
      (WidgetTester tester) async {
        final harness = await pumpHouseholdRoute(
          tester,
          AppRoutes.joinHousehold,
          repository: FakeHouseholdRepository(
            joinError: const HouseholdFullError('This household is full.'),
          ),
        );

        await _type(tester, 'K4M9PQ');
        await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
        await tester.pumpAndSettle();

        expect(location(harness.router), AppRoutes.joinHouseholdFull);
      },
    );

    testWidgets('NOT_FOUND stays put and explains what to do', (
      WidgetTester tester,
    ) async {
      final harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.joinHousehold,
        repository: FakeHouseholdRepository(
          joinError: const NotFoundError('Not found.'),
        ),
      );

      await _type(tester, 'K4M9PQ');
      await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.joinHousehold);
      expect(find.byKey(EnterCodeScreen.errorKey), findsOne);
      expect(find.text(noSuchInviteCodeMessage), findsOne);
    });

    testWidgets('RATE_LIMITED renders the server message verbatim', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        AppRoutes.joinHousehold,
        repository: FakeHouseholdRepository(
          joinError: const RateLimitedError('Too many attempts today.'),
        ),
      );

      await _type(tester, 'K4M9PQ');
      await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('Too many attempts today.'), findsOne);
    });

    testWidgets('no error line before anything has been attempted', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      expect(find.byKey(EnterCodeScreen.errorKey), findsNothing);
    });
  });

  group('EnterCodeScreen — back', () {
    testWidgets('returns to the first-run chooser', (
      WidgetTester tester,
    ) async {
      final harness = await pumpHouseholdRoute(tester, AppRoutes.joinHousehold);

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.firstRun);
    });
  });
}

/// Reads the Join button's enabled state.
///
/// A `null` `onPressed` is exactly how `PButton` expresses "disabled", so this
/// asserts the property the screen actually sets rather than a rendering detail
/// of whichever variant is in use.
class PButtonFinder {
  PButtonFinder(this.tester);

  final WidgetTester tester;

  bool get isEnabled =>
      tester
          .widget<PButton>(find.byKey(EnterCodeScreen.joinButtonKey))
          .onPressed !=
      null;
}
