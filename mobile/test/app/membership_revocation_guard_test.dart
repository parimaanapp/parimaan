import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/membership_revocation_guard.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';

import '../support/fake_household_repository.dart';
import '../support/household_fixtures.dart';

/// Unit-level widget tests for [MembershipRevocationGuard] in isolation from
/// the real router — `membership_revocation_router_test.dart` covers the
/// end-to-end `context.go(AppRoutes.firstRun)` outcome through the real
/// `goRouterProvider`; these tests exercise the guard's own two branches
/// directly, including the `household == null` one the router-level tests
/// never hit (code-reviewer LOW finding — both router tests start from an
/// already-resolved active household).
void main() {
  testWidgets(
    'no active household — never calls onRevoked, renders child as-is',
    (WidgetTester tester) async {
      int revokedCalls = 0;
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          // `activeHouseholdProvider` is a plain (non-family) `Provider`, so
          // overriding it directly is simpler and more targeted than
          // constructing the "no households anywhere" state through every
          // provider it composes (join/wizard/`Query.me`).
          activeHouseholdProvider.overrideWithValue(null),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MembershipRevocationGuard(
            onRevoked: (BuildContext _) => revokedCalls++,
            child: const Text('household screen', textDirection: TextDirection.ltr),
          ),
        ),
      );

      expect(find.text('household screen'), findsOneWidget);
      expect(revokedCalls, 0);
    },
  );

  testWidgets(
    'an active household with a live revocation push calls onRevoked exactly once',
    (WidgetTester tester) async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      int revokedCalls = 0;
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          activeHouseholdProvider.overrideWithValue(testHousehold),
          householdRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MembershipRevocationGuard(
            onRevoked: (BuildContext _) => revokedCalls++,
            child: const Text('household screen', textDirection: TextDirection.ltr),
          ),
        ),
      );
      await tester.pump();
      expect(revokedCalls, 0);

      repository.revokedControllers[testHousehold.id]!.add(null);
      await tester.pump();

      expect(revokedCalls, 1);
    },
  );
}
