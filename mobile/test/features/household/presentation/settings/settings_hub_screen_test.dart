import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/presentation/settings/settings_hub_screen.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/household_route_harness.dart';

const String _route = '/household/household-1/settings';

/// Scrolls [key]'s row into view.
///
/// The hub is a `ListView`, which builds lazily — the rows below the fold
/// genuinely do not exist in the tree until scrolled to, so every assertion
/// about a lower row has to bring it on screen first. This is a property of
/// the list, not a workaround: it is also why a user has to scroll to reach
/// Sign out.
Future<void> _reveal(WidgetTester tester, Key key) async {
  await tester.dragUntilVisible(
    find.byKey(key),
    find.byType(Scrollable).first,
    const Offset(0, -80),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('SettingsHubScreen — the rows the wireframe specifies', () {
    testWidgets('renders every row, with the household name and member count', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _route);

      expect(find.text('Kulkarni Kitchen'), findsOne);
      expect(find.text('Members (4)'), findsOne);
      expect(find.text('Meal structure'), findsOne);
      expect(find.text('Cuisine preferences'), findsOne);
      expect(find.text('Dietary tags'), findsOne);
      expect(find.text('Allergens & skip list'), findsOne);

      await _reveal(tester, SettingsHubScreen.signOutRowKey);
      expect(find.text('Notifications'), findsOne);
      expect(find.text('About Parimaan'), findsOne);
      expect(find.text('Sign out'), findsOne);
    });

    testWidgets('Members navigates to the members list', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, _route);

      await tester.tap(find.byKey(SettingsHubScreen.membersRowKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), '/household/household-1/members');
    });

    testWidgets(
      'the four preference rows reach the wizard screens in edit mode',
      (WidgetTester tester) async {
        // A list of records rather than a map: `Key` overrides `==`, so it
        // cannot be a const map key.
        const List<(Key, String)> expected = <(Key, String)>[
          (
            SettingsHubScreen.mealStructureRowKey,
            '/household/household-1/settings/meal-structure',
          ),
          (
            SettingsHubScreen.cuisineRowKey,
            '/household/household-1/settings/cuisine',
          ),
          (
            SettingsHubScreen.dietaryRowKey,
            '/household/household-1/settings/dietary',
          ),
          // Two rows, one destination: screen 2.6 owns dietary tags, allergens
          // and the skip list together, in a single patch.
          (
            SettingsHubScreen.allergensRowKey,
            '/household/household-1/settings/dietary',
          ),
        ];

        for (final (Key key, String path) in expected) {
          final HouseholdHarness harness = await pumpHouseholdRoute(
            tester,
            _route,
          );

          await tester.tap(find.byKey(key));
          await tester.pumpAndSettle();

          expect(location(harness.router), path);
        }
      },
    );

    testWidgets(
      'the stub rows open a real "coming soon" screen, not a dead tap',
      (WidgetTester tester) async {
        for (final (Key key, String path) in <(Key, String)>[
          (
            SettingsHubScreen.notificationsRowKey,
            '/household/household-1/settings/notifications',
          ),
          (
            SettingsHubScreen.aboutRowKey,
            '/household/household-1/settings/about',
          ),
        ]) {
          final HouseholdHarness harness = await pumpHouseholdRoute(
            tester,
            _route,
          );

          await _reveal(tester, key);
          await tester.tap(find.byKey(key));
          await tester.pumpAndSettle();

          expect(location(harness.router), path);
          expect(find.text('Coming soon'), findsOne);
        }
      },
    );
  });

  group('SettingsHubScreen — Leave and Delete are role-exclusive', () {
    testWidgets('the primary sees Delete and never Leave', (
      WidgetTester tester,
    ) async {
      // `testSignedInSession` is user-1, the primary of the fixture household.
      await pumpHouseholdRoute(tester, _route);
      await _reveal(tester, SettingsHubScreen.signOutRowKey);

      expect(find.byKey(SettingsHubScreen.deleteRowKey), findsOne);
      expect(
        find.byKey(SettingsHubScreen.leaveRowKey),
        findsNothing,
        reason: 'the server refuses a primary leave — do not offer it at all',
      );
    });

    testWidgets('a member sees Leave and never Delete', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, _route, session: testMemberSession);
      await _reveal(tester, SettingsHubScreen.signOutRowKey);

      expect(find.byKey(SettingsHubScreen.leaveRowKey), findsOne);
      expect(find.byKey(SettingsHubScreen.deleteRowKey), findsNothing);
    });

    testWidgets('Leave calls the mutation and returns to first-run', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        _route,
        session: testMemberSession,
      );

      await _reveal(tester, SettingsHubScreen.leaveRowKey);
      await tester.tap(find.byKey(SettingsHubScreen.leaveRowKey));
      await tester.pumpAndSettle();

      expect(harness.repository.leaveCalls, <String>['household-1']);
      expect(location(harness.router), AppRoutes.firstRun);
    });

    testWidgets('a refused Leave stays put and renders the server message', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        _route,
        session: testMemberSession,
        repository: FakeHouseholdRepository(
          fetchResult: testHouseholdWithMembers,
          leaveError: const ForbiddenError('Nope, not allowed.'),
        ),
      );

      await _reveal(tester, SettingsHubScreen.leaveRowKey);
      await tester.tap(find.byKey(SettingsHubScreen.leaveRowKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), _route);
      expect(find.text('Nope, not allowed.'), findsOne);
    });
  });

  group('SettingsHubScreen — load and refresh failures differ', () {
    testWidgets('a total load failure renders an empty state with a way out', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        _route,
        repository: FakeHouseholdRepository(
          fetchError: const ForbiddenError('Not a member.'),
        ),
      );

      expect(find.text('Could not load this household'), findsOne);
      expect(find.text('Back to home'), findsOne);
    });

    testWidgets(
      'a failed refresh keeps the rows on screen — content the user is '
      'reading is not replaced by an error page',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          _route,
        );
        expect(find.text('Members (4)'), findsOne);

        harness.repository.fetchError = const InternalError('network down');
        await harness.container
            .read(currentHouseholdControllerProvider('household-1').notifier)
            .refresh();
        await tester.pumpAndSettle();

        expect(find.text('Members (4)'), findsOne);
        expect(find.text('network down'), findsOne);
      },
    );
  });
}
