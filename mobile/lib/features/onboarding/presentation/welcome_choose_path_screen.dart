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
/// ## The forward-reference this screen's own copy carries (D1)
///
/// Tapping "Add New Recipe" here lands on the recipe method chooser against
/// a library that is empty for every household — the 50 curated recipes
/// only seed on `createHousehold` once W16's seeder Lambda exists (Q8's
/// copy-per-household decision, W15/W16's content weeks). This screen's
/// body copy therefore asks the user to add *their* first recipe rather
/// than promising a catalog. Once W16 ships, a newly created household will
/// already have 50 recipes, and this CTA's target state changes from
/// "empty library, add one" to "50 recipes, add your own" — without this
/// screen itself changing. Naming that here is the point: a reader who
/// finds this screen after W16 should not conclude the CTA was
/// mis-targeted.
class WelcomeChoosePathScreen extends ConsumerWidget {
  const WelcomeChoosePathScreen({super.key});

  static const Key pantryButtonKey = Key('welcome-add-to-pantry');
  static const Key recipeButtonKey = Key('welcome-add-recipe');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
                buttonKey: pantryButtonKey,
                title: 'Add to Pantry',
                body:
                    'Log what you already have on hand, so the app knows '
                    "what's available when it plans your meals.",
                actionLabel: 'Add to Pantry',
                variant: PButtonVariant.primary,
                onPressed: () => context.push(
                  AppRoutes.pantryAddChooseMethod(householdId),
                ),
              ),
              const SizedBox(height: AppSpacing.s5),
              _PathCard(
                buttonKey: recipeButtonKey,
                title: 'Add New Recipe',
                body:
                    'Your recipe library starts empty — add the first one '
                    'your household actually cooks.',
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
