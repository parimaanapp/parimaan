import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../support/fake_auth_repository.dart';
import '../support/fake_household_repository.dart';
import '../support/household_fixtures.dart';

String _location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

/// Boots the real router, signed in, already on `/home` for [testHousehold]
/// — the shell tabs' common ancestor the D7 revocation guard wraps
/// (`_MembershipRevocationGuard` in `app/router.dart`) — and hands back both
/// the [GoRouter] and the [FakeHouseholdRepository] so a test can simulate a
/// live `onMembershipRevoked` push via `repository.revokedControllers`, the
/// same shape `current_household_controller_test.dart` uses for
/// `onHouseholdChanged`.
Future<({GoRouter router, FakeHouseholdRepository repository})> _pumpSignedInHome(
  WidgetTester tester,
) async {
  final FakeHouseholdRepository repository = FakeHouseholdRepository(
    myHouseholdsResult: <Household>[testHousehold],
    fetchResult: testHousehold,
  );
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(
        stubbedAuthRepository(session: testSignedInSession),
      ),
      householdRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);

  await container.read(authControllerProvider.future);
  final GoRouter router = container.read(goRouterProvider);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router, theme: parimaanTheme()),
    ),
  );
  await tester.pumpAndSettle();

  return (router: router, repository: repository);
}

void main() {
  group('D7 — onMembershipRevoked routes the shell away (E2E_MVP_PLAN.md §17.2.7)', () {
    testWidgets(
      'a live push for the active household navigates from /home to /first-run',
      (WidgetTester tester) async {
        final ({GoRouter router, FakeHouseholdRepository repository}) subject =
            await _pumpSignedInHome(tester);
        expect(_location(subject.router), AppRoutes.home);
        expect(subject.repository.revokedWatchCalls, contains(testHousehold.id));

        subject.repository.revokedControllers[testHousehold.id]!.add(null);
        await tester.pumpAndSettle();

        expect(_location(subject.router), AppRoutes.firstRun);
      },
    );

    testWidgets(
      'no push means no navigation — the guard never fires on its own',
      (WidgetTester tester) async {
        final ({GoRouter router, FakeHouseholdRepository repository}) subject =
            await _pumpSignedInHome(tester);

        await tester.pump(const Duration(milliseconds: 50));

        expect(_location(subject.router), AppRoutes.home);
      },
    );
  });
}
