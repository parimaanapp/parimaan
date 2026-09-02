import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/auth/state/auth_controller.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/menu/presentation/today_screen.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_screen.dart';
import 'package:mobile/features/pantry/presentation/add_method_screen.dart';
import 'package:mobile/features/pantry/presentation/manual_add_screen.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/presentation/ai_failure_screen.dart';
import 'package:mobile/features/recipes/presentation/freeform_input_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_detail_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_draft_review_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_method_screen.dart';
import 'package:mobile/features/recipes/presentation/url_import_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/p_tab_bar.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../support/fake_auth_repository.dart';
import '../support/fake_household_repository.dart';
import '../support/household_fixtures.dart';
import '../support/household_route_harness.dart'
    show HouseholdHarness, pumpHouseholdRoute;

String _location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.toString();

/// Boots the real router against faked repositories and waits for the auth
/// controller to resolve, so assertions never race the splash redirect.
///
/// [households] defaults to an empty list — every pre-existing test in this
/// file was written against the old unconditional-`/first-run` redirect
/// (W8 S1, §14.2.11), and an empty list reproduces that exact landing without
/// any of them having to know the household list now matters. A test that
/// cares about the new home-vs-first-run split passes [households] or
/// [householdsError] explicitly, or [neverResolveHouseholds] for the
/// still-loading case — `pumpAndSettle` still terminates for that one, since
/// nothing schedules further frames once the permanently-loading state itself
/// settles.
Future<GoRouter> _pumpRouter(
  WidgetTester tester, {
  required AuthSession session,
  List<Household> households = const <Household>[],
  Object? householdsError,
  bool neverResolveHouseholds = false,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(
        stubbedAuthRepository(session: session),
      ),
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(
          myHouseholdsResult: neverResolveHouseholds ? null : households,
          myHouseholdsError: householdsError,
          neverCompletes: neverResolveHouseholds,
        ),
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

    testWidgets('deep navigation to /home/recipes is redirected to /sign-in', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: const AuthSession.signedOut(),
      );

      router.go(AppRoutes.recipes);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.signIn);
    });

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

    testWidgets(
      'settles on /home, not /first-run, when the signed-in user already has a household',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
          households: <Household>[testHousehold],
        );

        expect(_location(router), AppRoutes.home);
      },
    );

    testWidgets(
      'navigation to /sign-in lands on /home, not /first-run, for a user with a household',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
          households: <Household>[testHousehold],
        );

        router.go(AppRoutes.signIn);
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.home);
      },
    );

    testWidgets(
      'stays on splash while the household list is still resolving — no flash to /first-run',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
          neverResolveHouseholds: true,
        );

        // The household query never resolves in this test, so this is the
        // guard's permanent answer, not a snapshot mid-transition — proving
        // the loading state is read *before* any flash to /first-run, not
        // just that the final location happens to be right.
        expect(_location(router), AppRoutes.splash);
      },
    );

    testWidgets(
      'an errored household query lands on /first-run, the same as an empty list',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
          householdsError: StateError('network error'),
        );

        expect(_location(router), AppRoutes.firstRun);
      },
    );

    testWidgets(
      'a genuine sign-in refetches the household list rather than reusing a '
      'stale pre-login failure (flutter-reviewer finding, W8 S1)',
      (WidgetTester tester) async {
        // `meHouseholdsControllerProvider` starts fetching at router
        // construction, before auth has resolved — in production that fetch
        // fails with `UnauthorizedError` because there is no token yet, the
        // same shape a caller with no session ever gets. Modelled here as a
        // configured error rather than a real auth-link failure, since this
        // test is about the redirect's response to a *stale* answer, not
        // about `AuthLink` itself (covered by its own tests).
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          myHouseholdsError: StateError('no session yet'),
        );
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          null,
          session: const AuthSession.signedOut(),
          repository: repository,
        );
        expect(_location(harness.router), AppRoutes.signIn);
        expect(repository.myHouseholdsCallCount, 1);

        // The real answer, now that a session actually exists — reconfigured
        // on the same fake object, the way a real network response would
        // simply differ once a valid token is attached to the request.
        repository.myHouseholdsError = null;
        repository.myHouseholdsResult = <Household>[testHousehold];

        // Sign in through the same session stream the real Cognito Hub
        // pushes through — the shape `join_deep_link_router_test.dart`
        // already uses for its own sign-in-bounce test.
        harness.sessions.add(testSignedInSession);
        await tester.pumpAndSettle();

        expect(_location(harness.router), AppRoutes.home);
        expect(
          repository.myHouseholdsCallCount,
          2,
          reason:
              'a second, genuinely fresh fetch — not a cached pre-login '
              'error reused after sign-in',
        );
      },
    );

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
      // `pump`, not `pumpAndSettle` — same reason as `/home/pantry`'s own
      // reachability test below: with no household stubbed in this
      // harness, `TodayScreen` shows its own `CircularProgressIndicator`
      // (household == null), whose indeterminate animation never settles.
      // Two pumps: one for the navigation/shell-branch transition, one for
      // the newly-built branch's first frame.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(_location(router), AppRoutes.home);
      // No household stubbed in this harness — `TodayScreen` shows its own
      // loading state rather than the former `HomeScreen`'s static "Signed
      // in" text (W9 S6: `TodayScreen` replaced `HomeScreen` as the Home
      // tab's real content).
      expect(find.byKey(TodayScreen.loadingKey), findsOneWidget);
    });

    testWidgets('/home renders a four-item PTabBar', (
      WidgetTester tester,
    ) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.home);
      // Same reason as the reachability test above — two pumps, one for
      // the navigation/shell-branch transition, one for the newly-built
      // branch's first frame.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.byType(PTabBar), findsOneWidget);
      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Plan'), findsOneWidget);
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

    testWidgets(
      '/home/pantry/add stays reachable and renders AddMethodScreen',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(AppRoutes.pantryAddChooseMethod('household-1'));
        await tester.pumpAndSettle();

        expect(
          _location(router),
          AppRoutes.pantryAddChooseMethod('household-1'),
        );
        expect(find.byType(AddMethodScreen), findsOneWidget);
      },
    );

    testWidgets(
      '/home/pantry/add/manual stays reachable and renders ManualAddScreen',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(AppRoutes.pantryManualAdd('household-1'));
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.pantryManualAdd('household-1'));
        expect(find.byType(ManualAddScreen), findsOneWidget);
      },
    );

    testWidgets(
      '/home/recipes/new/method stays reachable and renders RecipeMethodScreen, householdId threaded through',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(AppRoutes.recipeChooseMethod('household-1'));
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.recipeChooseMethod('household-1'));
        expect(find.byType(RecipeMethodScreen), findsOneWidget);
        expect(
          tester
              .widget<RecipeMethodScreen>(find.byType(RecipeMethodScreen))
              .householdId,
          'household-1',
        );
      },
    );

    testWidgets(
      '/home/recipes/new/url stays reachable and renders UrlImportScreen — distinct from the method/freeform routes, not swallowed by an earlier pattern',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(AppRoutes.recipeUrlImport('household-1'));
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.recipeUrlImport('household-1'));
        expect(find.byType(UrlImportScreen), findsOneWidget);
        expect(find.byType(RecipeMethodScreen), findsNothing);
      },
    );

    testWidgets(
      '/home/recipes/new/freeform stays reachable and renders FreeformInputScreen — distinct from the method/url routes, not swallowed by an earlier pattern',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        router.go(AppRoutes.recipeFreeformInput('household-1'));
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.recipeFreeformInput('household-1'));
        expect(find.byType(FreeformInputScreen), findsOneWidget);
        expect(find.byType(RecipeMethodScreen), findsNothing);
      },
    );

    testWidgets(
      '/home/recipes/new/review stays reachable and renders RecipeDraftReviewScreen with the pushed extra',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        const AiRecipeDraft draft = AiRecipeDraft(title: 'Rajma Chawal');
        router.go(
          AppRoutes.recipeDraftReview('household-1'),
          extra: (draft: draft, sourceUrl: null),
        );
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.recipeDraftReview('household-1'));
        expect(find.byType(RecipeDraftReviewScreen), findsOneWidget);
        final RecipeDraftReviewScreen screen = tester
            .widget<RecipeDraftReviewScreen>(
              find.byType(RecipeDraftReviewScreen),
            );
        expect(screen.householdId, 'household-1');
        expect(screen.draft, draft);
      },
    );

    testWidgets(
      '/home/recipes/new/ai-failure stays reachable and renders AiFailureScreen with the pushed extra',
      (WidgetTester tester) async {
        final GoRouter router = await _pumpRouter(
          tester,
          session: testSignedInSession,
        );

        const error = UrlUnreadableError("Couldn't read that page.");
        router.go(
          AppRoutes.recipeAiFailure('household-1'),
          extra: (
            error: error,
            preservedInput: 'https://example.com/unreadable',
            inputLabel: 'URL',
          ),
        );
        await tester.pumpAndSettle();

        expect(_location(router), AppRoutes.recipeAiFailure('household-1'));
        expect(find.byType(AiFailureScreen), findsOneWidget);
        final AiFailureScreen screen = tester.widget<AiFailureScreen>(
          find.byType(AiFailureScreen),
        );
        expect(screen.householdId, 'household-1');
        expect(screen.error, error);
        expect(screen.preservedInput, 'https://example.com/unreadable');
      },
    );

    testWidgets(
      '/home/recipes/:recipeId stays reachable and renders RecipeDetailScreen',
      (WidgetTester tester) async {
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
      },
    );

    testWidgets('tapping the Pantry tab switches branch and preserves Home '
        'branch state', (WidgetTester tester) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.home);
      // `pump`, not `pumpAndSettle` — `TodayScreen`'s own spinner never
      // settles with no household data stubbed in this harness. Two pumps:
      // one for the navigation/shell-branch transition itself, one for the
      // newly-built branch's first frame — one alone leaves the widget
      // tree mid-transition, with `PTabBar`/`TodayScreen` not yet present
      // to find.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
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
        find.byKey(TodayScreen.loadingKey, skipOffstage: false),
        findsOneWidget,
      );

      await tester.tap(find.text('Home'));
      // `pump`, not `pumpAndSettle` — same reason as this test's own
      // initial navigation to /home: `TodayScreen`'s spinner never settles
      // with no household data stubbed in this harness.
      await tester.pump();
      expect(_location(router), AppRoutes.home);
    });

    testWidgets('tapping the Plan tab switches branch and preserves Home '
        'branch state', (WidgetTester tester) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.home);
      // Same reason as the Pantry-tab test above.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(_location(router), AppRoutes.home);

      await tester.tap(find.text('Plan'));
      // Same reason as the Pantry-tab test above: `WeeklyPlanScreen`'s
      // own spinner never settles with no household data stubbed in this
      // harness.
      await tester.pump();
      expect(_location(router), AppRoutes.weeklyPlan);
      expect(find.byType(WeeklyPlanScreen), findsOneWidget);

      // Same IndexedStack-keeps-every-branch-alive assertion as the
      // Pantry-tab test above.
      expect(
        find.byKey(TodayScreen.loadingKey, skipOffstage: false),
        findsOneWidget,
      );

      await tester.tap(find.text('Home'));
      await tester.pump();
      expect(_location(router), AppRoutes.home);
    });

    testWidgets('tapping the Recipes tab switches branch and preserves Home '
        'branch state', (WidgetTester tester) async {
      final GoRouter router = await _pumpRouter(
        tester,
        session: testSignedInSession,
      );

      router.go(AppRoutes.home);
      // `pump`, not `pumpAndSettle` — `TodayScreen`'s own spinner never
      // settles with no household data stubbed in this harness. Two pumps:
      // one for the navigation/shell-branch transition itself, one for the
      // newly-built branch's first frame — one alone leaves the widget
      // tree mid-transition, with `PTabBar`/`TodayScreen` not yet present
      // to find.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(_location(router), AppRoutes.home);

      await tester.tap(find.text('Recipes'));
      // Same reason as the Pantry-tab test above: RecipesLibraryScreen's
      // spinner never settles with no household data stubbed in this
      // harness. Two pumps, same transition-then-first-frame reasoning as
      // this test's own initial navigation to /home.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(_location(router), AppRoutes.recipes);

      expect(
        find.byKey(TodayScreen.loadingKey, skipOffstage: false),
        findsOneWidget,
      );

      await tester.tap(find.text('Home'));
      // `pump`, not `pumpAndSettle` — same reason as this test's own
      // initial navigation to /home: `TodayScreen`'s spinner never settles
      // with no household data stubbed in this harness.
      await tester.pump();
      expect(_location(router), AppRoutes.home);
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
