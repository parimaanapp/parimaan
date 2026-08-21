import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/presentation/join/confirm_join_screen.dart';
import 'package:mobile/features/household/presentation/join/enter_code_screen.dart';
import 'package:mobile/features/household/presentation/join/invite_code_field.dart';
import 'package:mobile/features/household/state/join_household_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/household_route_harness.dart';

/// Walks the real flow: type a code on 3.1, join, land on 3.2.
///
/// Driven through the screens rather than by seeding the controller, so the
/// hand-off between the two is exercised rather than assumed.
Future<HouseholdHarness> _join(
  WidgetTester tester, {
  FakeHouseholdRepository? repository,
}) async {
  final HouseholdHarness harness = await pumpHouseholdRoute(
    tester,
    AppRoutes.joinHousehold,
    repository:
        repository ??
        FakeHouseholdRepository(joinResult: testHouseholdWithMembers),
  );

  await tester.enterText(find.byKey(InviteCodeField.hiddenFieldKey), 'K4M9PQ');
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
  await tester.pumpAndSettle();

  return harness;
}

void main() {
  group('ConfirmJoinScreen — the joined household', () {
    testWidgets('shows the household name', (WidgetTester tester) async {
      await _join(tester);

      expect(find.text(ConfirmJoinScreen.heading), findsOne);
      expect(find.text('Kulkarni Kitchen'), findsOne);
    });

    testWidgets('summarises members, dietary tags and cuisines', (
      WidgetTester tester,
    ) async {
      await _join(tester);

      // The summary is only renderable because the join already happened —
      // there is no query that could have produced it beforehand.
      expect(find.byKey(ConfirmJoinScreen.summaryKey), findsOne);
      expect(find.textContaining('4 members'), findsOne);
    });

    testWidgets('the summary line pluralises and orders its parts', (
      WidgetTester tester,
    ) async {
      expect(
        householdSummaryLine(testHouseholdWithMembers),
        startsWith('4 members · '),
      );
      expect(householdSummaryLine(testHousehold), startsWith('1 member · '));
      expect(householdSummaryLine(testHousehold), contains('North Indian'));
    });
  });

  group('ConfirmJoinScreen — the button pair', () {
    testWidgets('the primary action continues into the app', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await _join(tester);

      await tester.tap(find.byKey(ConfirmJoinScreen.continueButtonKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.home);
    });

    testWidgets(
      'the ghost action is a real undo — it calls leaveHousehold, not just a '
      'navigation',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await _join(tester);

        await tester.tap(find.byKey(ConfirmJoinScreen.leaveButtonKey));
        await tester.pumpAndSettle();

        expect(harness.repository.leaveCalls, <String>['household-1']);
        expect(location(harness.router), AppRoutes.joinHousehold);
      },
    );

    testWidgets('a failed leave stays put and says why', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await _join(
        tester,
        repository: FakeHouseholdRepository(
          joinResult: testHouseholdWithMembers,
          leaveError: const InternalError('network down'),
        ),
      );

      await tester.tap(find.byKey(ConfirmJoinScreen.leaveButtonKey));
      await tester.pumpAndSettle();

      // Still a member, so still on the confirmation.
      expect(location(harness.router), AppRoutes.joinConfirm);
      expect(find.byKey(ConfirmJoinScreen.errorKey), findsOne);
      expect(find.text('network down'), findsOne);
    });
  });

  group('ConfirmJoinScreen — reached with nothing joined', () {
    testWidgets('renders an empty state with a way onward, not a blank page', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.joinConfirm,
      );

      expect(find.byKey(ConfirmJoinScreen.noHouseholdKey), findsOne);
      expect(find.text('Enter an invite code'), findsOne);

      await tester.tap(find.text('Enter an invite code'));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.joinHousehold);
    });

    testWidgets('the join controller starts empty', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.joinConfirm,
      );

      final Household? joined = harness.container
          .read(joinHouseholdControllerProvider)
          .valueOrNull;
      expect(joined, isNull);
    });
  });
}
