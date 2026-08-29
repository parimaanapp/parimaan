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
import '../features/household/presentation/create/wizard_flow.dart';
import '../features/household/presentation/join/confirm_join_screen.dart';
import '../features/household/presentation/join/enter_code_screen.dart';
import '../features/household/presentation/join/household_full_screen.dart';
import '../features/household/presentation/settings/household_edit_entry.dart';
import '../features/household/presentation/settings/members_list_screen.dart';
import '../features/household/presentation/settings/settings_hub_screen.dart';
import '../features/household/presentation/settings/settings_placeholder_screen.dart';
import '../features/household/state/pending_join_code_controller.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/onboarding/presentation/first_run_choose_path_screen.dart';
import '../features/pantry/domain/pantry_item.dart';
import '../features/pantry/presentation/add_method_screen.dart';
import '../features/pantry/presentation/manual_add_screen.dart';
import '../features/pantry/presentation/pantry_list_screen.dart';
import '../features/recipes/domain/ai_recipe_draft.dart';
import '../features/recipes/domain/recipe.dart';
import '../features/recipes/presentation/freeform_input_screen.dart';
import '../features/recipes/presentation/recipe_detail_screen.dart';
import '../features/recipes/presentation/recipe_draft_review_screen.dart';
import '../features/recipes/presentation/recipe_form_screen.dart';
import '../features/recipes/presentation/recipe_method_screen.dart';
import '../features/recipes/presentation/recipes_library_screen.dart';
import '../features/recipes/presentation/url_import_screen.dart';
import '../features/shell/presentation/app_shell.dart';

/// Every path the app can be at. String literals live here and nowhere else.
abstract final class AppRoutes {
  static const String splash = '/splash';
  static const String signIn = '/sign-in';

  /// The post-sign-in landing screen: create a household, or join one.
  static const String firstRun = '/first-run';

  // ── The join flow (wireframe flow 3) ──────────────────────────────────────

  /// Wireframe 3.1 — the six-box invite code entry. Also where a
  /// `parimaan://join?code=` deep link lands, with the code prefilled and an
  /// explicit tap still required — but the code itself is carried by
  /// `pendingJoinCodeControllerProvider`, not this route's URL. The redirect
  /// that resumes a deep link after a sign-in bounce lives in `_redirect`
  /// below, inside its already-signed-in branch; see that provider's own doc
  /// comment for the full mechanism.
  static const String joinHousehold = '/join';

  /// Wireframe 3.2 — the post-join confirmation. See `EnterCodeScreen`'s doc
  /// for why the join has already happened by the time this renders.
  static const String joinConfirm = '/join/confirm';

  /// Wireframe 3.3 — the 5-member cap.
  static const String joinHouseholdFull = '/join/full';

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

  // ── Settings (wireframe flow 4) ───────────────────────────────────────────
  //
  // Household-scoped and therefore parameterised by id, unlike the wizard's
  // flat paths: `CurrentHouseholdController` is a family keyed on the id, and
  // putting the id in the path is what makes these screens addressable and
  // testable without any ambient "which household am I in" state.

  /// The path pattern go_router matches. [settingsHub] builds a concrete one.
  static const String settingsHubPattern = '/household/:householdId/settings';
  static const String membersPattern = '/household/:householdId/members';
  static const String settingsNotificationsPattern =
      '/household/:householdId/settings/notifications';
  static const String settingsAboutPattern =
      '/household/:householdId/settings/about';

  /// The four Settings rows that reuse the wizard's own screens in edit mode.
  /// See `presentation/create/wizard_flow.dart`.
  static const String editMealStructurePattern =
      '/household/:householdId/settings/meal-structure';
  static const String editCuisinePattern =
      '/household/:householdId/settings/cuisine';
  static const String editCuisineBiasPattern =
      '/household/:householdId/settings/cuisine-bias';
  static const String editDietaryPattern =
      '/household/:householdId/settings/dietary';

  /// The path parameter every settings route carries.
  static const String householdIdParameter = 'householdId';

  static String settingsHub(String householdId) =>
      '/household/$householdId/settings';
  static String members(String householdId) =>
      '/household/$householdId/members';
  static String settingsNotifications(String householdId) =>
      '/household/$householdId/settings/notifications';
  static String settingsAbout(String householdId) =>
      '/household/$householdId/settings/about';
  static String editMealStructure(String householdId) =>
      '/household/$householdId/settings/meal-structure';
  static String editCuisine(String householdId) =>
      '/household/$householdId/settings/cuisine';
  static String editCuisineBias(String householdId) =>
      '/household/$householdId/settings/cuisine-bias';
  static String editDietary(String householdId) =>
      '/household/$householdId/settings/dietary';

  static const String home = '/home';

  /// The Pantry tab of the signed-in shell — a sibling branch of [home], not
  /// a child route, even though the path nests under it. See the
  /// `StatefulShellRoute` in [goRouterProvider].
  static const String pantry = '/home/pantry';

  /// The Recipes tab of the signed-in shell (W6 S6) — same sibling-branch
  /// shape as [pantry].
  static const String recipes = '/home/recipes';

  // ── Pantry add/edit (wireframes 9.2, 9.3 — W5 S6) ────────────────────────
  //
  // Both are flat, pushed routes *outside* the shell (not a third branch) —
  // unlike Home/Pantry, the add/edit flow has its own full-screen chrome
  // (its own `PTopBar`, no bottom tab bar) and is reached with `context.push`
  // rather than `context.go`, so `Navigator.pop()` inside `ManualAddScreen`
  // returns to whichever pantry screen pushed it. `householdId` travels as a
  // query parameter (both screens need it, including before a `PantryItem`
  // exists to carry it); the optional [PantryItem] being edited travels as
  // `extra` — it has no sensible URL encoding and does not need to survive a
  // deep link.

  static const String _pantryAddChooseMethodPattern = '/home/pantry/add';
  static String pantryAddChooseMethod(String householdId) =>
      '$_pantryAddChooseMethodPattern?householdId=$householdId';

  static const String _pantryManualAddPattern = '/home/pantry/add/manual';
  static String pantryManualAdd(String householdId) =>
      '$_pantryManualAddPattern?householdId=$householdId';

  // ── Recipe Detail (wireframes 7.2/7.3 — W6 S7) ───────────────────────────
  //
  // A flat, pushed route *outside* the shell, same reasoning as pantry
  // add/edit above — its own full-screen chrome, reached via `context.push`
  // so `context.pop()` inside `RecipeDetailScreen` returns to the Library.
  // `recipeId` travels as a real path parameter, not a query param like
  // pantry's `householdId`: unlike a not-yet-created `PantryItem`, a recipe
  // always already has an id by the time this route is reached (tapped from
  // an already-loaded `RecipeCard`), so there is no "doesn't exist yet"
  // case to work around.

  static const String recipeIdParameter = 'recipeId';
  static const String _recipeDetailPattern = '/home/recipes/:recipeId';
  static String recipeDetail(String recipeId) => '/home/recipes/$recipeId';

  // ── Recipe create/edit form (wireframe 8.2 — W6 S8) ──────────────────────
  //
  // Both flat, pushed routes outside the shell, same reasoning as above.
  // Create's `householdId` travels as a query param — the pantry
  // add/edit precedent — since a not-yet-created recipe has no id to hang
  // a path segment on. Edit's `recipeId` is a real path segment (same
  // reasoning as [recipeDetail] above: it always already has one); the
  // already-loaded `Recipe` being edited travels as `extra`, same as
  // `ManualAddScreen`'s `initialItem` — no sensible URL encoding and no
  // need to survive a deep link.

  static const String _recipeCreatePattern = '/home/recipes/new';
  static String recipeCreate(String householdId) =>
      '$_recipeCreatePattern?householdId=$householdId';

  static const String _recipeEditPattern = '/home/recipes/:recipeId/edit';
  static String recipeEdit(String recipeId) => '/home/recipes/$recipeId/edit';

  // W7 S8 (wireframe 8.1) — the "how do you want to add this recipe"
  // chooser, now the FAB's real destination; [recipeCreate] above is the
  // chooser's "Structured entry" option's own unchanged target, not a
  // route this slice touches. Same query-param-not-path-segment convention
  // as [recipeCreate]/[_pantryAddChooseMethodPattern] — none of these three
  // destinations exist yet when the chooser is reached, so there is no id
  // to hang a path segment on.
  static const String _recipeMethodPattern = '/home/recipes/new/method';
  static String recipeChooseMethod(String householdId) =>
      '$_recipeMethodPattern?householdId=$householdId';

  // S9's own screen (URL import, wireframe 8.3) — routed to here ahead of
  // that slice's own build, per S8's locked scope: the chooser needs a
  // real destination to route to today, not a TODO. S9 replaces this
  // file's contents, not this route.
  static const String _recipeUrlImportPattern = '/home/recipes/new/url';
  static String recipeUrlImport(String householdId) =>
      '$_recipeUrlImportPattern?householdId=$householdId';

  // S10's own screen (Freeform input, wireframe 8.4) — same "route exists
  // now, real screen lands with its own slice" shape as [recipeUrlImport].
  static const String _recipeFreeformInputPattern =
      '/home/recipes/new/freeform';
  static String recipeFreeformInput(String householdId) =>
      '$_recipeFreeformInputPattern?householdId=$householdId';

  // The shared draft-review screen (wireframe 8.5, W7 S10, D6) — both S9's
  // URL import and S10's freeform paste push here on a successful parse.
  // `householdId` travels as a query param, same reasoning as
  // [recipeCreate]; the parsed [RecipeDraftReviewExtra] (an `AiRecipeDraft`
  // plus an optional `sourceUrl`) travels as `extra`, same reasoning as
  // [recipeEdit]'s already-loaded `Recipe` — no sensible URL encoding, no
  // need to survive a deep link (a draft was never persisted).
  static const String _recipeDraftReviewPattern = '/home/recipes/new/review';
  static String recipeDraftReview(String householdId) =>
      '$_recipeDraftReviewPattern?householdId=$householdId';
}

/// `extra` payload for [AppRoutes.recipeDraftReview] — see that route's own
/// doc.
typedef RecipeDraftReviewExtra = ({AiRecipeDraft draft, String? sourceUrl});

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

  // A pending deep-linked invite code also has to re-run the guard: it arrives
  // asynchronously, possibly while the user is sitting on /sign-in, and the
  // resume in `_redirect` cannot fire without a refresh to trigger it.
  ref.listen<String?>(
    pendingJoinCodeControllerProvider,
    (String? _, String? _) => refresh.value++,
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
            const EnterCodeScreen(),
      ),
      GoRoute(
        path: AppRoutes.joinConfirm,
        builder: (BuildContext context, GoRouterState state) =>
            const ConfirmJoinScreen(),
      ),
      GoRoute(
        path: AppRoutes.joinHouseholdFull,
        builder: (BuildContext context, GoRouterState state) =>
            const HouseholdFullScreen(),
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
        path: AppRoutes.settingsHubPattern,
        builder: (BuildContext context, GoRouterState state) =>
            SettingsHubScreen(householdId: _householdId(state)),
      ),
      GoRoute(
        path: AppRoutes.membersPattern,
        builder: (BuildContext context, GoRouterState state) =>
            MembersListScreen(householdId: _householdId(state)),
      ),
      GoRoute(
        path: AppRoutes.settingsNotificationsPattern,
        builder: (BuildContext context, GoRouterState state) =>
            SettingsPlaceholderScreen.notifications(
              householdId: _householdId(state),
            ),
      ),
      GoRoute(
        path: AppRoutes.settingsAboutPattern,
        builder: (BuildContext context, GoRouterState state) =>
            SettingsPlaceholderScreen.about(householdId: _householdId(state)),
      ),
      // The four edit routes. Each is the *same widget* the create wizard
      // renders, wrapped in the entry point that loads the household and seeds
      // the draft from it. See `household_edit_entry.dart`.
      GoRoute(
        path: AppRoutes.editMealStructurePattern,
        builder: (BuildContext context, GoRouterState state) =>
            HouseholdEditEntry(
              householdId: _householdId(state),
              builder: (WizardFlowContext flow) =>
                  MealStructureScreen(flow: flow),
            ),
      ),
      GoRoute(
        path: AppRoutes.editCuisinePattern,
        builder: (BuildContext context, GoRouterState state) =>
            HouseholdEditEntry(
              householdId: _householdId(state),
              builder: (WizardFlowContext flow) =>
                  CuisineRegionsScreen(flow: flow),
            ),
      ),
      GoRoute(
        path: AppRoutes.editCuisineBiasPattern,
        builder: (BuildContext context, GoRouterState state) =>
            HouseholdEditEntry(
              householdId: _householdId(state),
              builder: (WizardFlowContext flow) =>
                  CuisineSubBiasScreen(flow: flow),
            ),
      ),
      GoRoute(
        path: AppRoutes.editDietaryPattern,
        builder: (BuildContext context, GoRouterState state) =>
            HouseholdEditEntry(
              householdId: _householdId(state),
              builder: (WizardFlowContext flow) =>
                  DietaryAllergensScreen(flow: flow),
            ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (
          BuildContext context,
          GoRouterState state,
          StatefulNavigationShell navigationShell,
        ) => AppShell(navigationShell: navigationShell),
        branches: <StatefulShellBranch>[
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: AppRoutes.home,
                builder: (BuildContext context, GoRouterState state) =>
                    const HomeScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: AppRoutes.pantry,
                builder: (BuildContext context, GoRouterState state) =>
                    const PantryListScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: AppRoutes.recipes,
                builder: (BuildContext context, GoRouterState state) =>
                    const RecipesLibraryScreen(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: AppRoutes._pantryAddChooseMethodPattern,
        builder: (BuildContext context, GoRouterState state) {
          final String householdId = _pantryHouseholdId(state);
          return AddMethodScreen(
            onManual: () =>
                context.push(AppRoutes.pantryManualAdd(householdId)),
          );
        },
      ),
      GoRoute(
        path: AppRoutes._pantryManualAddPattern,
        builder: (BuildContext context, GoRouterState state) => ManualAddScreen(
          householdId: _pantryHouseholdId(state),
          initialItem: state.extra as PantryItem?,
        ),
      ),
      GoRoute(
        path: AppRoutes._recipeDetailPattern,
        builder: (BuildContext context, GoRouterState state) =>
            RecipeDetailScreen(
              recipeId: state.pathParameters[AppRoutes.recipeIdParameter] ?? '',
            ),
      ),
      GoRoute(
        path: AppRoutes._recipeMethodPattern,
        builder: (BuildContext context, GoRouterState state) =>
            RecipeMethodScreen(householdId: _pantryHouseholdId(state)),
      ),
      GoRoute(
        path: AppRoutes._recipeUrlImportPattern,
        builder: (BuildContext context, GoRouterState state) =>
            UrlImportScreen(householdId: _pantryHouseholdId(state)),
      ),
      GoRoute(
        path: AppRoutes._recipeFreeformInputPattern,
        builder: (BuildContext context, GoRouterState state) =>
            FreeformInputScreen(householdId: _pantryHouseholdId(state)),
      ),
      GoRoute(
        path: AppRoutes._recipeDraftReviewPattern,
        builder: (BuildContext context, GoRouterState state) {
          final RecipeDraftReviewExtra extra =
              state.extra as RecipeDraftReviewExtra;
          return RecipeDraftReviewScreen(
            householdId: _pantryHouseholdId(state),
            draft: extra.draft,
            sourceUrl: extra.sourceUrl,
          );
        },
      ),
      GoRoute(
        path: AppRoutes._recipeCreatePattern,
        // Same query-param reader as pantry's add/edit routes — the
        // parameter itself is generic (just `householdId`), not
        // pantry-specific, despite the helper's name.
        builder: (BuildContext context, GoRouterState state) =>
            RecipeFormScreen(householdId: _pantryHouseholdId(state)),
      ),
      GoRoute(
        path: AppRoutes._recipeEditPattern,
        // `extra` is never optional here (unlike `ManualAddScreen`'s
        // `initialItem`, where absence means create mode) — this route
        // only exists to edit an already-loaded `Recipe`, and is only ever
        // reached in-app from the Overflow menu, which always has one. A
        // missing `extra` is a genuine caller bug, not a malformed deep
        // link (no wireframe exposes an editable URL to this route), so a
        // clear cast failure here is preferable to a route that silently
        // can't tell which household a not-yet-loaded recipe belongs to.
        builder: (BuildContext context, GoRouterState state) {
          final Recipe recipe = state.extra as Recipe;
          return RecipeFormScreen(
            householdId: recipe.householdId,
            initialRecipe: recipe,
          );
        },
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

/// The `:householdId` path parameter, or the empty string.
///
/// Empty rather than a throw: an id-less settings URL is a malformed deep link,
/// and the screens already render an honest "could not load this household"
/// state for an id the server rejects. Crashing the route builder would turn a
/// bad link into a redscreen.
String _householdId(GoRouterState state) =>
    state.pathParameters[AppRoutes.householdIdParameter] ?? '';

/// The `householdId` query parameter both pantry add/edit routes carry —
/// see `AppRoutes`' doc on why it travels as a query param rather than a
/// path segment.
String _pantryHouseholdId(GoRouterState state) =>
    state.uri.queryParameters['householdId'] ?? '';

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
    // A deep-linked invite code that was interrupted by the sign-in bounce
    // resumes here, and *only* here — after authentication has already been
    // established by the branch above. This is deliberately a resume, not a
    // bypass: an unauthenticated deep link still falls through to the signed-
    // out branch below and still lands on /sign-in, exactly as before. The
    // code survives that bounce because it lives in
    // `pendingJoinCodeControllerProvider` rather than in the URL — see that
    // class's doc.
    //
    // `read`, not `take`: the code is consumed by `EnterCodeScreen` when it
    // prefills the field. Consuming it here would clear it before the screen
    // that needs it has been built.
    final bool hasPendingCode =
        ref.read(pendingJoinCodeControllerProvider) != null;
    if (hasPendingCode && location != AppRoutes.joinHousehold) {
      return AppRoutes.joinHousehold;
    }

    // A signed-in user arriving from splash or bouncing off /sign-in lands on
    // the first-run screen, not /home. Note this is *unconditional* for now:
    // `MeHouseholdsController` exists and `activeHouseholdProvider` reads it,
    // but gating *this* redirect on it is deliberately deferred — every other
    // test in this file boots the router with no `householdRepositoryProvider`
    // override, and reading the me controller here would turn every one of
    // them into a network-dependent test for a guard they are not exercising.
    // The consequence is honest but temporary — a returning user with a
    // household still sees the choose-path screen. Wiring this in belongs to
    // a slice that also updates the router test harness to supply a fake
    // household repository, not this one.
    //
    // Every other signed-in location is left alone, so navigation *within* the
    // signed-in area is not fought by the guard.
    return location == AppRoutes.splash || location == AppRoutes.signIn
        ? AppRoutes.firstRun
        : null;
  }
  return location == AppRoutes.signIn ? null : AppRoutes.signIn;
}
