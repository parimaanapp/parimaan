import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/pantry/presentation/add_method_screen.dart';
import 'package:mobile/features/pantry/presentation/manual_add_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_detail_screen.dart';
import 'package:mobile/shared/ui/components/p_tab_bar.dart';
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

    testWidgets(
      'deep navigation to /home/recipes is redirected to /sign-in',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: const AuthSession.signedOut(),
        );

        router.go(AppRoutes.recipes);
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.signIn);
      },
    );

    testWidgets(
      'deep navigation to /home/recipes/:recipeId is redirected to /sign-in',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: const AuthSession.signedOut(),
        );

        router.go(AppRoutes.recipeDetail('recipe-1'));
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.signIn);
      },
    );

    testWidgets(
      'deep navigation to /home/pantry/add is redirected to /sign-in',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: const AuthSession.signedOut(),
        );

        router.go(AppRoutes.pantryAddChooseMethod('household-1'));
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.signIn);
      },
    );

    testWidgets(
      'deep navigation to /home/pantry/add/manual is redirected to /sign-in',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: const AuthSession.signedOut(),
        );

        router.go(AppRoutes.pantryManualAdd('household-1'));
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.signIn);
      },
    );

    testWidgets('deep navigation to /home/pantry is redirected to /sign-in', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: const AuthSession.signedOut(),
      );

      router.go(AppRoutes.pantry);
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

    testWidgets('/home renders a three-item PTabBar', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.home);
      await tester.pumpAndSettle();

      expect(find.byType(PTabBar), findsOneWidget);
      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Pantry'), findsOneWidget);
      expect(find.text('Recipes'), findsOneWidget);
    });

    testWidgets('/home/pantry stays reachable and is not bounced back', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.pantry);
      // Not `pumpAndSettle`: `PantryListScreen` shows a `CircularProgressIndicator`
      // while `activeHouseholdProvider` resolves, and this harness (unlike
      // `household_route_harness.dart`) stubs no household data at all — an
      // indefinite spinner never settles. A location/route assertion doesn't
      // need the fetch to finish.
      await tester.pump();

      expect(_location(router), AppRoutes.pantry);
    });

    testWidgets('/home/recipes stays reachable and is not bounced back', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.recipes);
      // Not `pumpAndSettle`: `RecipesLibraryScreen` shows a
      // `CircularProgressIndicator` while `activeHouseholdProvider`
      // resolves, and this harness stubs no household data at all — same
      // reasoning as the `/home/pantry` reachability test above.
      await tester.pump();

      expect(_location(router), AppRoutes.recipes);
    });

    testWidgets('/home/pantry/add stays reachable and renders AddMethodScreen', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.pantryAddChooseMethod('household-1'));
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.pantryAddChooseMethod('household-1'));
      expect(find.byType(AddMethodScreen), findsOneWidget);
    });

    testWidgets('/home/pantry/add/manual stays reachable and renders ManualAddScreen', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.pantryManualAdd('household-1'));
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.pantryManualAdd('household-1'));
      expect(find.byType(ManualAddScreen), findsOneWidget);
    });

    testWidgets('/home/recipes/:recipeId stays reachable and renders RecipeDetailScreen', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.recipeDetail('recipe-1'));
      // Not `pumpAndSettle`: `RecipeDetailScreen`'s spinner never settles
      // with no household data stubbed in this harness — same reasoning as
      // the `/home/pantry` reachability test above. Two pumps, not one:
      // unlike a shell-branch swap, this is a real pushed-route page
      // transition (this route lives outside the shell, like
      // `pantryManualAdd`), which needs a frame for the transition itself
      // before the new page's own build settles.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(_location(router), AppRoutes.recipeDetail('recipe-1'));
      expect(find.byType(RecipeDetailScreen), findsOneWidget);
    });

    testWidgets(
      'tapping the Pantry tab switches branch and preserves Home '
      'branch state',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(AppRoutes.home);
        await tester.pumpAndSettle();
        expect(_location(router), AppRoutes.home);

        await tester.tap(find.text('Pantry'));
        // Same reason as the test above: PantryListScreen's spinner never
        // settles with no household data stubbed in this harness.
        await tester.pump();
        expect(_location(router), AppRoutes.pantry);

        // A StatefulShellRoute keeps every branch's widget tree alive in an
        // IndexedStack rather than disposing it on switch — this is the
        // property that makes the shell "stateful" rather than a plain
        // rebuild-per-tab layout. `skipOffstage: false` because the whole
        // point of the assertion is that Home's tree survives while it is
        // the *unpainted* branch — the default `find.text` would only prove
        // the opposite.
        expect(
          find.text('Signed in', skipOffstage: false),
          findsOneWidget,
        );

        await tester.tap(find.text('Home'));
        await tester.pumpAndSettle();
        expect(_location(router), AppRoutes.home);
      },
    );

    testWidgets(
      'tapping the Recipes tab switches branch and preserves Home '
      'branch state',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(AppRoutes.home);
        await tester.pumpAndSettle();
        expect(_location(router), AppRoutes.home);

        await tester.tap(find.text('Recipes'));
        // Same reason as the Pantry-tab test above: RecipesLibraryScreen's
        // spinner never settles with no household data stubbed in this
        // harness.
        await tester.pump();
        expect(_location(router), AppRoutes.recipes);

        expect(
          find.text('Signed in', skipOffstage: false),
          findsOneWidget,
        );

        await tester.tap(find.text('Home'));
        await tester.pumpAndSettle();
        expect(_location(router), AppRoutes.home);
      },
    );

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
