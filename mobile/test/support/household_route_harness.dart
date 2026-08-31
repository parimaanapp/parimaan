import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/app/join_deep_link_listener.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/shared/ui/theme.dart';

import 'fake_auth_repository.dart';
import 'fake_household_repository.dart';
import 'household_fixtures.dart';

/// What a pumped household route hands back to a test.
typedef HouseholdHarness = ({
  GoRouter router,
  ProviderContainer container,
  FakeHouseholdRepository repository,

  /// Deep links. Add a [Uri] to simulate one arriving.
  StreamController<Uri> links,

  /// Auth session changes — the same stream `AuthController` subscribes to.
  /// Add a session to simulate a sign-in or sign-out *after* the initial
  /// resolution, which is what the deep-link resume test needs.
  StreamController<AuthSession> sessions,
});

/// The router's current path.
String location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

/// A session for a **non-primary** member of the fixture households.
///
/// `testSignedInSession` is `user-1`, who is the primary in both
/// `testHousehold` and `testHouseholdWithMembers` — so every role-dependent
/// assertion needs this second identity to exercise the other branch.
const AuthSession testMemberSession = AuthSession.signedIn(
  userId: 'user-2',
  email: 'priya@example.com',
  displayName: 'Priya',
);

/// Boots the **real** app router (plus the deep-link listener) and navigates
/// to [route].
///
/// Going through the router rather than pumping a screen bare is what makes
/// navigation and guard assertions real — the same reasoning as
/// `pumpWizardRoute`, which this generalises for the household-scoped screens:
/// those need a settable session identity (to exercise primary vs. member) and
/// a controllable deep-link stream.
///
/// The link stream is overridden with a plain [StreamController] so no
/// `app_links` platform channel is ever touched; a test drives deep links by
/// adding to `harness.links`.
Future<HouseholdHarness> pumpHouseholdRoute(
  WidgetTester tester,
  String? route, {
  FakeHouseholdRepository? repository,
  AuthSession session = testSignedInSession,
  List<Override> overrides = const <Override>[],
}) async {
  final FakeHouseholdRepository repo =
      repository ??
      FakeHouseholdRepository(
        result: testHousehold,
        fetchResult: testHouseholdWithMembers,
        settingsResult: testHouseholdSettings,
        // Router `_redirect` reads `meHouseholdsControllerProvider` on every
        // splash/sign-in landing (W8 S1) — an unset `myHouseholdsResult`
        // would surface as an error there instead of a clean empty answer.
        // Every test here navigates to an explicit route past that landing,
        // so this default is inert for them; it exists so this harness never
        // depends on the redirect's error-handling path by accident.
        myHouseholdsResult: const <Household>[],
      );

  final StreamController<Uri> links = StreamController<Uri>.broadcast();
  addTearDown(links.close);

  final StreamController<AuthSession> sessions =
      StreamController<AuthSession>.broadcast();
  addTearDown(sessions.close);

  final MockAuthRepository auth = stubbedAuthRepository(session: session);
  // Replace the default never-emitting stream so a test can drive a sign-in
  // mid-run rather than only choosing a starting state.
  when(auth.sessionChanges).thenAnswer((_) => sessions.stream);

  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(auth),
      householdRepositoryProvider.overrideWithValue(repo),
      linkStreamProvider.overrideWithValue(links.stream),
      ...overrides,
    ],
  );
  addTearDown(container.dispose);

  await container.read(authControllerProvider.future);

  // The router is disposed by `goRouterProvider`'s own `ref.onDispose`, which
  // the container tear-down triggers — disposing it here too would throw.
  final GoRouter router = container.read(goRouterProvider);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: JoinDeepLinkListener(
        child: MaterialApp.router(routerConfig: router, theme: parimaanTheme()),
      ),
    ),
  );
  await tester.pumpAndSettle();

  if (route != null) {
    router.go(route);
    await tester.pumpAndSettle();
  }

  return (
    router: router,
    container: container,
    repository: repo,
    links: links,
    sessions: sessions,
  );
}
