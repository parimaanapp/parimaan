import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/household/state/active_household_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/presentation/settings/household_list_screen.dart';
import 'package:mobile/features/household/presentation/settings/settings_hub_screen.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/shared/ui/components/components.dart';

import '../../../../support/fake_active_household_store.dart';
import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_fixtures.dart';
import '../../../../support/household_route_harness.dart';

Household _household(String id, String name, {String primary = 'user-1'}) =>
    Household(
      id: id,
      name: name,
      inviteCode: 'CODE-$id',
      primaryUserId: primary,
      subscriptionStatus: SubscriptionStatus.free,
      settings: testHousehold.settings,
      members: const <HouseholdMembership>[],
    );

FakeHouseholdRepository _repo(List<Household> households) =>
    FakeHouseholdRepository(
      result: testHousehold,
      // Every household's own read returns the four-member roster.
      fetchResult: testHouseholdWithMembers,
      myHouseholdsResult: households,
    );

final Household _old = _household('h-old', 'S9 Sync Test');
final Household _real = _household(
  'h-real',
  'Kulkarni Kitchen',
  primary: 'u-9',
);

void main() {
  group('HouseholdListScreen', () {
    testWidgets('lists each household with member count, role and Active', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(<Household>[_old, _real]),
      );

      expect(find.text('Households'), findsOne);
      expect(find.text('S9 Sync Test'), findsOne);
      expect(find.text('Kulkarni Kitchen'), findsOne);
      expect(find.text('4 members · Primary'), findsOne);
      expect(find.text('4 members · Member'), findsOne);
      // The oldest is the active household by default.
      expect(find.byKey(HouseholdListScreen.activeBadgeKey), findsOne);
      expect(find.byKey(HouseholdListScreen.switchKey('h-old')), findsNothing);
      expect(find.byKey(HouseholdListScreen.switchKey('h-real')), findsOne);
    });

    testWidgets('Switch buttons use a filled variant (18.7px label)', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(<Household>[_old, _real]),
      );

      final PButton button = tester.widget<PButton>(
        find.byKey(HouseholdListScreen.switchKey('h-real')),
      );
      expect(button.variant, PButtonVariant.primary);
      expect(button.label, 'Switch');
    });

    testWidgets('tapping a non-active household activates it and returns to '
        'Today', (WidgetTester tester) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(<Household>[_old, _real]),
      );

      await tester.tap(find.byKey(HouseholdListScreen.switchKey('h-real')));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.home);
      expect(harness.container.read(activeHouseholdProvider)?.id, 'h-real');
    });

    testWidgets('tapping the row itself also switches', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(<Household>[_old, _real]),
      );

      await tester.tap(find.text('Kulkarni Kitchen'));
      await tester.pumpAndSettle();

      expect(harness.container.read(activeHouseholdProvider)?.id, 'h-real');
      expect(location(harness.router), AppRoutes.home);
    });

    testWidgets('the persisted choice is the one marked Active', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(<Household>[_old, _real]),
        overrides: <Override>[
          activeHouseholdStoreProvider.overrideWithValue(
            InMemoryActiveHouseholdStore(
              userId: 'user-1',
              householdId: 'h-real',
            ),
          ),
        ],
      );

      expect(find.byKey(HouseholdListScreen.switchKey('h-real')), findsNothing);
      expect(find.byKey(HouseholdListScreen.switchKey('h-old')), findsOne);
    });

    testWidgets('shows the household-cap notice only at the limit', (
      WidgetTester tester,
    ) async {
      final List<Household> five = <Household>[
        for (int i = 0; i < 5; i++) _household('h-$i', 'House $i'),
      ];
      await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(five),
      );

      expect(find.text('You are in 5 of 5 households.'), findsOne);
      await tester.dragUntilVisible(
        find.byKey(HouseholdListScreen.capNoticeKey),
        find.byType(Scrollable).first,
        const Offset(0, -80),
      );
      expect(find.byKey(HouseholdListScreen.capNoticeKey), findsOne);
    });

    testWidgets('no cap notice below the limit', (WidgetTester tester) async {
      await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(<Household>[_old, _real]),
      );

      expect(find.text('You are in 2 of 5 households.'), findsOne);
      expect(find.byKey(HouseholdListScreen.capNoticeKey), findsNothing);
    });

    testWidgets('the back chevron returns to Settings', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: _repo(<Household>[_old, _real]),
      );

      await tester.tap(find.bySemanticsLabel('Back to settings'));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.settingsHub('h-old'));
    });

    testWidgets('shows a retry state when the list cannot be loaded', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(
        tester,
        AppRoutes.households,
        repository: FakeHouseholdRepository(
          result: testHousehold,
          myHouseholdsError: StateError('offline'),
        ),
      );

      expect(find.byKey(HouseholdListScreen.errorKey), findsOne);
      expect(find.text('Try again'), findsOne);
    });
  });

  group('Settings hub entry points', () {
    Future<HouseholdHarness> pumpHub(WidgetTester tester) => pumpHouseholdRoute(
      tester,
      AppRoutes.settingsHub('h-old'),
      repository: _repo(<Household>[_old, _real]),
    );

    testWidgets('"You belong to N households" opens the household list', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHub(tester);

      await tester.tap(find.byKey(SettingsHubScreen.householdCountRowKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.households);
    });

    testWidgets('the Household row opens the household list', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHub(tester);

      await tester.tap(find.byKey(SettingsHubScreen.householdRowKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.households);
    });
  });
}
