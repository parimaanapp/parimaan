import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/household_wizard_controller.dart';
import 'package:mobile/shared/ui/theme.dart';

import 'fake_auth_repository.dart';
import 'fake_household_repository.dart';
import 'household_fixtures.dart';

/// What a pumped wizard screen hands back to a test.
typedef WizardHarness = ({
  GoRouter router,
  ProviderContainer container,
  FakeHouseholdRepository repository,
});

/// The router's current path.
String currentLocation(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

/// Boots the **real** app router, signed in, and navigates to [route].
///
/// Going through the router rather than pumping a screen bare is what makes
/// every navigation assertion real: a test that asserts "Continue advances to
/// the cuisine screen" is otherwise only asserting that a callback fired.
///
/// [adoptHousehold] controls whether the wizard already holds a created
/// household. Screens after 2.1 all assume one, and a test that wants the
/// "reached without a household" state passes `false`.
Future<WizardHarness> pumpWizardRoute(
  WidgetTester tester,
  String route, {
  FakeHouseholdRepository? repository,
  bool adoptHousehold = true,
}) async {
  final FakeHouseholdRepository repo =
      repository ??
      FakeHouseholdRepository(
        result: testHousehold,
        settingsResult: testHouseholdSettings,
        // See `household_route_harness.dart`'s identical default — the
        // router's `_redirect` reads `meHouseholdsControllerProvider` on
        // every splash landing (W8 S1), and this harness always navigates
        // past that landing to an explicit `route`, so this default is inert
        // for every test here; it exists so none of them depend on the
        // redirect's error-handling path by accident.
        myHouseholdsResult: const <Household>[],
      );

  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(
        stubbedAuthRepository(session: testSignedInSession),
      ),
      householdRepositoryProvider.overrideWithValue(repo),
    ],
  );
  addTearDown(container.dispose);

  await container.read(authControllerProvider.future);
  await container.read(householdWizardControllerProvider.future);
  if (adoptHousehold) {
    container
        .read(householdWizardControllerProvider.notifier)
        .adoptHousehold(testHousehold);
  }

  // The router is disposed by `goRouterProvider`'s own `ref.onDispose`, which
  // the container tear-down triggers — disposing it here too would throw.
  final GoRouter router = container.read(goRouterProvider);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router, theme: parimaanTheme()),
    ),
  );
  await tester.pumpAndSettle();

  router.go(route);
  await tester.pumpAndSettle();

  return (router: router, container: container, repository: repo);
}
