import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../support/fake_auth_repository.dart';

String _location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

/// Boots the real router against a faked repository and waits for the auth
/// controller to resolve, so assertions never race the splash redirect.
Future<GoRouter> _pumpRouter(
  WidgetTester tester, {
  required AuthSession session,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(
        stubbedAuthRepository(session: session),
      ),
    ],
  );
  addTearDown(container.dispose);

  await container.read(authControllerProvider.future);
  // The router is disposed by `goRouterProvider`'s own `ref.onDispose`, which
  // the container tear-down above triggers — disposing it here too would throw.
  final GoRouter router = container.read(goRouterProvider);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router, theme: parimaanTheme()),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

void main() {
  group('router redirect guard — signed out', () {
    testWidgets('settles on /sign-in from the initial splash', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: const AuthSession.signedOut(),
      );

      expect(_location(router), AppRoutes.signIn);
    });

    testWidgets('deep navigation to /home is redirected to /sign-in', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: const AuthSession.signedOut(),
      );

      router.go(AppRoutes.home);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.signIn);
    });

    testWidgets('deep navigation to /first-run is redirected to /sign-in', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: const AuthSession.signedOut(),
      );

      router.go(AppRoutes.firstRun);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.signIn);
    });

    testWidgets('deep navigation to /join is redirected to /sign-in', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: const AuthSession.signedOut(),
      );

      router.go(AppRoutes.joinHousehold);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.signIn);
    });

    testWidgets('/sign-in is reachable and not redirected', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: const AuthSession.signedOut(),
      );

      router.go(AppRoutes.signIn);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.signIn);
      expect(find.text('Continue with Google'), findsOneWidget);
    });
  });

  group('router redirect guard — signed in', () {
    testWidgets('settles on /first-run from the initial splash', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      expect(_location(router), AppRoutes.firstRun);
      expect(find.text('Set up your kitchen'), findsOne);
    });

    testWidgets('navigation to /sign-in is redirected to /first-run', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.signIn);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.firstRun);
    });

    testWidgets('/splash is redirected to /first-run', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.splash);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.firstRun);
    });

    // The guard must not fight navigation *within* the signed-in area — this
    // is what lets the first-run screen send the user onward after a
    // successful create.
    testWidgets('/home stays reachable and is not bounced back', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.home);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.home);
      expect(find.text('Signed in'), findsOne);
    });

    testWidgets('/join stays reachable and is not bounced back', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.joinHousehold);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.joinHousehold);
    });
  });

  group('router — the household setup wizard', () {
    /// Every wizard step, in the order the user walks them.
    const List<String> wizardRoutes = <String>[
      AppRoutes.createHouseholdName,
      AppRoutes.createHouseholdMeals,
      AppRoutes.createHouseholdStructure,
      AppRoutes.createHouseholdCuisine,
      AppRoutes.createHouseholdCuisineBias,
      AppRoutes.createHouseholdDietary,
      AppRoutes.createHouseholdInvite,
    ];

    for (final String route in wizardRoutes) {
      testWidgets('$route is registered and reachable when signed in', (
        WidgetTester tester,
      ) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(route);
        await tester.pumpAndSettle();

        // Reachable *and* not bounced: the guard must not fight navigation
        // within the signed-in area, which is what the whole wizard is.
        expect(_location(router), route);
      });

      testWidgets('$route is guarded when signed out', (
        WidgetTester tester,
      ) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: const AuthSession.signedOut(),
        );

        router.go(route);
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.signIn);
      });
    }

    testWidgets('every wizard path is distinct', (WidgetTester tester) async {
      expect(wizardRoutes.toSet(), hasLength(wizardRoutes.length));
    });
  });
}
