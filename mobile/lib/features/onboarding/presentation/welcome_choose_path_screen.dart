import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../../household/state/household_activity_provider.dart';

/// The fifth Flow 1 screen (E2E_MVP_PLAN.md §19.2.1 D1, W13 S6) — where a
/// signed-in user who already has a household, but hasn't done anything
/// real in it yet (Q20/D2's threshold, computed by
/// `household_activity_provider.dart`), lands instead of `/home`.
///
/// ## Built on `FirstRunChoosePathScreen`'s own precedent, deliberately
///
/// Same shape as `first_run_choose_path_screen.dart`'s chooser: a
/// [ConsumerWidget], two `_PathCard`-equivalent CTAs, no local state,
/// nothing async, no server-error line. That screen's own doc explains why
/// it ended up shaped that way — the mutation it used to own moved
/// elsewhere, leaving a pure chooser — and this screen is built the same
/// way from the start, for the identical reason: it makes no writes of its
/// own, it only routes the user to the screen that will. There is
/// therefore no loading state and no error state anywhere in this file.
///
/// It is a routed screen at [AppRoutes.welcome], not a modal, a bottom
/// sheet, or a banner on Home — `_redirect` in `app/router.dart` needs a
/// real location to send people to, and a dialog cannot be a redirect
/// target (D1).
///
/// ## Recipe copy is true with or without seeded recipes
///
/// A new household may or may not start with curated recipes, so the recipe
/// card's copy asks the user to add a recipe their household cooks rather than
/// claiming the library is empty.
///
/// ## Leaving Welcome
///
/// The first pantry item / recipe / planned meal is added from a screen pushed
/// on top of this one. `_redirect` only re-evaluates the top route, so this
/// screen listens to `householdHasActivityProvider` itself and moves to home
/// once it is visible again (see `_advance`).
class WelcomeChoosePathScreen extends ConsumerStatefulWidget {
  const WelcomeChoosePathScreen({super.key});

  static const Key pantryButtonKey = Key('welcome-add-to-pantry');
  static const Key recipeButtonKey = Key('welcome-add-recipe');

  @override
  ConsumerState<WelcomeChoosePathScreen> createState() =>
      _WelcomeChoosePathScreenState();
}

class _WelcomeChoosePathScreenState
    extends ConsumerState<WelcomeChoosePathScreen> {
  /// A deferred advance is already waiting for the covering route to go away.
  bool _waiting = false;
  ModalRoute<Object?>? _waitingRoute;
  AnimationStatusListener? _statusListener;

  @override
  void initState() {
    super.initState();
    // Already past the threshold when first built (e.g. data arrived between
    // the router's decision and this build): move on straight away.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted &&
          ref.read(householdHasActivityProvider).valueOrNull == true) {
        _advance();
      }
    });
  }

  @override
  void dispose() {
    _stopWaiting();
    super.dispose();
  }

  void _stopWaiting() {
    final AnimationStatusListener? listener = _statusListener;
    if (listener != null) {
      _waitingRoute?.secondaryAnimation?.removeStatusListener(listener);
    }
    _statusListener = null;
    _waitingRoute = null;
    _waiting = false;
  }

  /// Leaves Welcome for home — but only once Welcome is the visible route
  /// again. The first item is added from a screen pushed *on top of* Welcome;
  /// yanking the user to home mid-flow would cut that screen off, so the move
  /// waits until it has been popped.
  void _advance() {
    if (!mounted || _waiting) return;
    final ModalRoute<Object?>? route = ModalRoute.of(context);
    final Animation<double>? covered = route?.secondaryAnimation;
    if (route != null && !route.isCurrent && covered != null) {
      _waiting = true;
      _waitingRoute = route;
      _statusListener = (AnimationStatus status) {
        if (status == AnimationStatus.dismissed) {
          _stopWaiting();
          _advance();
        }
      };
      covered.addStatusListener(_statusListener!);
      return;
    }
    context.go(AppRoutes.home);
  }

  @override
  Widget build(BuildContext context) {
    // The first pantry item / recipe / planned meal flips this to true; the
    // router only re-evaluates the *top* route, so Welcome must react itself.
    ref.listen<AsyncValue<bool>>(householdHasActivityProvider, (
      AsyncValue<bool>? _,
      AsyncValue<bool> next,
    ) {
      if (next.valueOrNull == true) _advance();
    });

    // By construction, `_redirect` only ever sends a signed-in user here
    // once `meHouseholdsControllerProvider` has already resolved to a
    // non-empty list (see that function's own doc) — so `activeHousehold`
    // is expected to already be resolved by the time this screen builds,
    // same guarantee `RecipesLibraryScreen`/`PantryListScreen` rely on for
    // their own tab-root reads. The empty-string fallback (rather than a
    // loading branch or a throw) matches `router.dart`'s own `_householdId`
    // convention for a malformed/unexpected state: an honest no-op route
    // argument, not a crash.
    final Household? household = ref.watch(activeHouseholdProvider);
    final String householdId = household?.id ?? '';

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.s6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                'Welcome!',
                style: AppTypography.displayM.copyWith(color: AppColors.ink),
              ),
              const SizedBox(height: AppSpacing.s2),
              Text(
                'What would you like to do first?',
                style: AppTypography.body.copyWith(color: AppColors.inkSoft),
              ),
              const SizedBox(height: AppSpacing.s5),
              _PathCard(
                buttonKey: WelcomeChoosePathScreen.pantryButtonKey,
                title: 'Add to Pantry',
                body:
                    'Log what you already have on hand, so the app knows '
                    "what's available when it plans your meals.",
                actionLabel: 'Add to Pantry',
                variant: PButtonVariant.primary,
                onPressed: () =>
                    context.push(AppRoutes.pantryAddChooseMethod(householdId)),
              ),
              const SizedBox(height: AppSpacing.s5),
              _PathCard(
                buttonKey: WelcomeChoosePathScreen.recipeButtonKey,
                title: 'Add New Recipe',
                body:
                    'Add a recipe your household cooks, so the app can '
                    'plan around it.',
                actionLabel: 'Add New Recipe',
                variant: PButtonVariant.secondary,
                onPressed: () =>
                    context.push(AppRoutes.recipeChooseMethod(householdId)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One of the two paths: a heading, a sentence, and the control that takes
/// it — the exact same shape as `first_run_choose_path_screen.dart`'s own
/// `_PathCard` (deliberately not shared code across the two files: each
/// screen's doc comment is what carries its own reasoning, and duplicating
/// this small a widget keeps that reasoning attached to its own file rather
/// than behind an indirection).
class _PathCard extends StatelessWidget {
  const _PathCard({
    required this.buttonKey,
    required this.title,
    required this.body,
    required this.actionLabel,
    required this.variant,
    required this.onPressed,
  });

  final Key buttonKey;
  final String title;
  final String body;
  final String actionLabel;
  final PButtonVariant variant;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => PCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(title, style: AppTypography.title.copyWith(color: AppColors.ink)),
        const SizedBox(height: AppSpacing.s2),
        Text(
          body,
          style: AppTypography.body.copyWith(color: AppColors.inkSoft),
        ),
        const SizedBox(height: AppSpacing.s4),
        PButton(
          key: buttonKey,
          label: actionLabel,
          variant: variant,
          expand: true,
          onPressed: onPressed,
        ),
      ],
    ),
  );
}
