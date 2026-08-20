import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/domain/auth_session.dart';
import '../features/auth/presentation/sign_in_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/auth/state/auth_controller.dart';
import '../features/household/presentation/create/cuisine_regions_screen.dart';
import '../features/household/presentation/create/cuisine_sub_bias_screen.dart';
import '../features/household/presentation/create/dietary_allergens_screen.dart';
import '../features/household/presentation/create/invite_code_screen.dart';
import '../features/household/presentation/create/meal_structure_screen.dart';
import '../features/household/presentation/create/name_household_screen.dart';
import '../features/household/presentation/create/which_meals_screen.dart';
import '../features/onboarding/presentation/first_run_choose_path_screen.dart';

/// Every path the app can be at. String literals live here and nowhere else.
abstract final class AppRoutes {
  static const String splash = '/splash';
  static const String signIn = '/sign-in';

  /// The post-sign-in landing screen: create a household, or join one.
  static const String firstRun = '/first-run';

  /// Stub destination for the join flow, which is a later slice. It is a real
  /// route rather than a dead button so the guard covers it and swapping in
  /// the real screen is a one-line change — see
  /// [JoinHouseholdComingSoonScreen].
  static const String joinHousehold = '/join';

  // ── The household setup wizard (wireframe flow 2) ────────────────────────
  //
  // Seven flat routes rather than a nested `ShellRoute`: the wizard has no
  // persistent chrome to share (each screen owns its own `PTopBar`, and the
  // step indicator differs per screen), so a shell would add a layer that
  // renders nothing. Flat routes also keep every step independently
  // addressable, which is what makes the back button and a deep link behave
  // the same way.
  //
  // The steps are ordered but not *guarded* in sequence: a screen reached
  // without a household renders its own honest empty/error state rather than
  // redirecting, because a redirect at this depth would fight the user's own
  // back navigation.

  /// Wireframe 2.1. Where the household is actually created.
  static const String createHouseholdName = '/household/create/name';

  /// Wireframe 2.2 — step 1/4.
  static const String createHouseholdMeals = '/household/create/meals';

  /// Wireframe 2.3 — step 2/4.
  static const String createHouseholdStructure = '/household/create/structure';

  /// Wireframe 2.4 — step 3/4, first frame.
  static const String createHouseholdCuisine = '/household/create/cuisine';

  /// Wireframe 2.5 — step 3/4, second frame.
  static const String createHouseholdCuisineBias =
      '/household/create/cuisine-bias';

  /// Wireframe 2.6 — step 4/4.
  static const String createHouseholdDietary = '/household/create/dietary';

  /// Wireframe 2.7 — the invite code, shown once setup finishes.
  static const String createHouseholdInvite = '/household/create/invite';

  static const String home = '/home';
}

/// The app's route table plus its auth guard.
///
/// `refreshListenable` is go_router's reactive hook: the [ValueNotifier] below
/// is bumped on every [authControllerProvider] state change, which makes
/// go_router re-run [_redirect]. That is what lets [SplashScreen] be a purely
/// passive screen — it never calls `go()` itself.
final Provider<GoRouter> goRouterProvider = Provider<GoRouter>((Ref ref) {
  final ValueNotifier<int> refresh = ValueNotifier<int>(0);
  ref.onDispose(refresh.dispose);

  // Also the subscription that keeps the auth controller alive for the whole
  // life of the router, so the session is resolved exactly once per app run.
  ref.listen<AsyncValue<AuthSession>>(
    authControllerProvider,
    (AsyncValue<AuthSession>? _, AsyncValue<AuthSession> _) => refresh.value++,
    fireImmediately: true,
  );

  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.splash,
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) =>
        _redirect(ref, state),
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.splash,
        builder: (BuildContext context, GoRouterState state) =>
            const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.signIn,
        builder: (BuildContext context, GoRouterState state) =>
            const SignInScreen(),
      ),
      GoRoute(
        path: AppRoutes.firstRun,
        builder: (BuildContext context, GoRouterState state) =>
            const FirstRunChoosePathScreen(),
      ),
      GoRoute(
        path: AppRoutes.joinHousehold,
        builder: (BuildContext context, GoRouterState state) =>
            const JoinHouseholdComingSoonScreen(),
      ),
      GoRoute(
        path: AppRoutes.createHouseholdName,
        builder: (BuildContext context, GoRouterState state) =>
            const NameHouseholdScreen(),
      ),
      GoRoute(
        path: AppRoutes.createHouseholdMeals,
        builder: (BuildContext context, GoRouterState state) =>
            const WhichMealsScreen(),
      ),
      GoRoute(
        path: AppRoutes.createHouseholdStructure,
        builder: (BuildContext context, GoRouterState state) =>
            const MealStructureScreen(),
      ),
      GoRoute(
        path: AppRoutes.createHouseholdCuisine,
        builder: (BuildContext context, GoRouterState state) =>
            const CuisineRegionsScreen(),
      ),
      GoRoute(
        path: AppRoutes.createHouseholdCuisineBias,
        builder: (BuildContext context, GoRouterState state) =>
            const CuisineSubBiasScreen(),
      ),
      GoRoute(
        path: AppRoutes.createHouseholdDietary,
        builder: (BuildContext context, GoRouterState state) =>
            const DietaryAllergensScreen(),
      ),
      GoRoute(
        path: AppRoutes.createHouseholdInvite,
        builder: (BuildContext context, GoRouterState state) =>
            const InviteCodeScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (BuildContext context, GoRouterState state) =>
            const _HomePlaceholderScreen(),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

/// Returns the path to move to, or `null` to stay put.
///
/// Three states, not two — "still resolving" is distinct from "signed out",
/// and conflating them would flash the sign-in screen at every cold start for
/// an already-signed-in user.
String? _redirect(Ref ref, GoRouterState state) {
  final AsyncValue<AuthSession> auth = ref.read(authControllerProvider);
  final String location = state.matchedLocation;

  final bool isResolving = auth.isLoading && !auth.hasValue;
  if (isResolving) {
    return location == AppRoutes.splash ? null : AppRoutes.splash;
  }

  // An errored session (including a config failure) is treated as signed out:
  // the sign-in screen is where that error is legible to the user.
  final bool isSignedIn = auth.valueOrNull?.isSignedIn ?? false;

  if (isSignedIn) {
    // A signed-in user arriving from splash or bouncing off /sign-in lands on
    // the first-run screen, not /home. Note this is *unconditional* for now:
    // deciding whether the user already has a household needs `Query.me`, and
    // no controller reads it yet. The consequence is honest but temporary — a
    // returning user with a household still sees the choose-path screen. The
    // slice that adds a `me` controller should gate this on
    // `households.isEmpty` rather than adding a second redirect.
    //
    // Every other signed-in location — /home, /join, /first-run itself — is
    // left alone, so navigation *within* the signed-in area is not fought by
    // the guard.
    return location == AppRoutes.splash || location == AppRoutes.signIn
        ? AppRoutes.firstRun
        : null;
  }
  return location == AppRoutes.signIn ? null : AppRoutes.signIn;
}

/// Stand-in for the real first-run / home screen, which is a later slice.
class _HomePlaceholderScreen extends StatelessWidget {
  const _HomePlaceholderScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: Text('Signed in')));
  }
}
