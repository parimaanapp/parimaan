import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/presentation/settings/members_list_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_route_harness.dart';

const String _route = '/household/household-1/members';

void main() {
  group('MembersListScreen — the roster', () {
    testWidgets('renders one row per membership', (WidgetTester tester) async {
      await pumpHouseholdRoute(tester, _route);

      for (final String id in <String>[
        'membership-1',
        'membership-2',
        'membership-3',
        'membership-4',
      ]) {
        expect(find.byKey(MembersListScreen.rowKey(id)), findsOne);
      }
    });

    testWidgets(
      'shows each member name, falling back to the email local part',
      (WidgetTester tester) async {
        await pumpHouseholdRoute(tester, _route);

        expect(find.text('Amogh'), findsOne);
        expect(find.text('Priya'), findsOne);
        // user-3 has no displayName — the local part, never the full address.
        expect(find.text('aai'), findsOne);
        expect(find.text('aai@example.com'), findsNothing);
      },
    );

    testWidgets('labels the primary and marks the caller as "you"', (
      WidgetTester tester,
    ) async {
      // user-1 is both the primary and the signed-in caller.
      await pumpHouseholdRoute(tester, _route);

      expect(find.text('primary · you'), findsOne);
      expect(find.text('member'), findsNWidgets(3));
    });

    testWidgets('marks a non-primary caller as "member · you"', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _route, session: testMemberSession);

      expect(find.text('member · you'), findsOne);
      expect(find.text('primary'), findsOne);
    });
  });

  group('MembersListScreen — the overflow affordance', () {
    testWidgets('is present on non-primary rows and absent on the primary', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _route);

      expect(
        find.byKey(MembersListScreen.overflowKey('membership-1')),
        findsNothing,
        reason: 'the wireframe draws no overflow on the primary row',
      );
      expect(
        find.byKey(MembersListScreen.overflowKey('membership-2')),
        findsOne,
      );
    });

    testWidgets('is disabled — no menu actions are specified yet', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _route);

      final PButton overflow = tester.widget<PButton>(
        find.byKey(MembersListScreen.overflowKey('membership-2')),
      );

      expect(overflow.onPressed, isNull);
    });
  });

  group('MembersListScreen — sharing the invite code', () {
    testWidgets('renders the code in the share area', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _route);

      expect(find.byKey(MembersListScreen.shareCodeKey), findsOne);
      expect(find.text('ABC123'), findsOne);
    });

    testWidgets('the share area reuses the wizard invite-code screen', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, _route);

      await tester.tap(find.byKey(MembersListScreen.shareCodeKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.createHouseholdInvite);
    });

    testWidgets('the top-bar "+" reuses the same screen', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, _route);

      await tester.tap(find.byKey(MembersListScreen.addButtonKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.createHouseholdInvite);
    });
  });

  group('MembersListScreen — navigation and failure', () {
    testWidgets('back returns to the settings hub', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, _route);

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(location(harness.router), '/household/household-1/settings');
    });

    testWidgets('a load failure renders an empty state with a way back', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        _route,
        repository: FakeHouseholdRepository(
          fetchError: const ForbiddenError('Not a member.'),
        ),
      );

      expect(find.text('Could not load members'), findsOne);
      expect(find.text('Not a member.'), findsOne);
    });
  });

  group('MembersListScreen — sync on entry', () {
    testWidgets('reads the household from the server on route entry', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, _route);

      // `HouseholdSyncScope.start()` refetches on mount, on top of the
      // controller's own initial build.
      expect(harness.repository.fetchCalls, isNotEmpty);
      expect(
        harness.repository.fetchCalls.every((String id) => id == 'household-1'),
        isTrue,
      );
    });
  });
}
