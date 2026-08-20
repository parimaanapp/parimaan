import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// The first thing a newly signed-in user sees: create a household, or join one
/// somebody else already made.
///
/// ## What changed here, and why
///
/// This screen used to own the household **name field** and call
/// `createHousehold` itself. It no longer does: naming is wireframe screen
/// 2.1, the first step of the setup wizard, and that is where the mutation now
/// lives (`NameHouseholdScreen`).
///
/// The reconciliation was not optional. Leaving the create call here as well
/// would give the app **two independent paths that create a household** — a
/// user who typed a name here and then walked the wizard would end up with two
/// households, the second one silently shadowing the first, and neither screen
/// would be wrong on its own. Choosing one owner was the only correct
/// resolution, and the wizard is the right owner: it is the screen the
/// wireframe puts the field on, it is the screen that holds the resulting
/// household for the five steps that follow, and it is where the ~30s Aurora
/// cold-start wait belongs — behind a deliberate "Continue", not behind the
/// first tap after sign-in.
///
/// What is left is what the wireframe (frame 1.3) actually draws: a chooser.
/// Both options are on one screen rather than behind a further chooser,
/// because with exactly two options a chooser is a wasted tap.
///
/// It is now a [ConsumerWidget] rather than a `ConsumerStatefulWidget`: with
/// the text field and its validation gone, there is no local state left, and
/// nothing on this screen is async any more — so there is also no loading
/// state and no server-error line. Those moved to the wizard along with the
/// mutation that produced them.
class FirstRunChoosePathScreen extends ConsumerWidget {
  const FirstRunChoosePathScreen({super.key});

  static const Key createButtonKey = Key('first-run-create');
  static const Key joinButtonKey = Key('first-run-join');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.s6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                'Set up your kitchen',
                style: AppTypography.displayM.copyWith(color: AppColors.ink),
              ),
              const SizedBox(height: AppSpacing.s2),
              Text(
                'A household is the kitchen you plan for. Start one, or join '
                'the one your family already uses.',
                style: AppTypography.body.copyWith(color: AppColors.inkSoft),
              ),
              const SizedBox(height: AppSpacing.s5),
              _PathCard(
                buttonKey: createButtonKey,
                title: 'Create a household',
                body:
                    "You'll be the primary member, and you'll get an invite "
                    'code to share.',
                actionLabel: 'Create a household',
                variant: PButtonVariant.primary,
                onPressed: () => context.go(AppRoutes.createHouseholdName),
              ),
              const SizedBox(height: AppSpacing.s5),
              _PathCard(
                buttonKey: joinButtonKey,
                title: 'Join a household',
                body:
                    'Someone in your family already set one up? Use their '
                    'invite code.',
                actionLabel: 'Join a household',
                variant: PButtonVariant.secondary,
                onPressed: () => context.go(AppRoutes.joinHousehold),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One of the two paths: a heading, a sentence, and the control that takes it.
///
/// The two cards were near-identical before and are now genuinely identical in
/// shape, so they are one widget rather than two — which is also what keeps
/// the "one primary button per screen" rule visible: the variant is a
/// parameter, and there is exactly one `primary` at the call site above.
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

/// Placeholder for the join flow.
///
/// `Mutation.joinHousehold` exists server-side and is fully tested, but the
/// invite-code entry screen, the deep-link handler (`parimaan://join?code=`)
/// and the `HOUSEHOLD_FULL` / `RATE_LIMITED` states it has to render are a
/// slice of their own. A real route showing an honest "not built yet" beats a
/// dead button: the path is discoverable, the router's guard already covers
/// it, and swapping this widget out is the entirety of the next change.
class JoinHouseholdComingSoonScreen extends StatelessWidget {
  const JoinHouseholdComingSoonScreen({super.key});

  static const Key bodyKey = Key('join-coming-soon');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      // `PTopBar` is a plain widget rather than a `PreferredSizeWidget`, so it
      // goes in the body above the content, not in `Scaffold.appBar`.
      body: SafeArea(
        child: Column(
          children: <Widget>[
            PTopBar(
              title: 'Join a household',
              onBack: () => context.go(AppRoutes.firstRun),
              backSemanticLabel: 'Back to setting up your kitchen',
            ),
            Expanded(
              child: Center(
                key: bodyKey,
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.s6),
                  child: PEmptyState(
                    headline: 'Not built yet',
                    body:
                        'Joining with an invite code is coming in the next update. '
                        'For now, create a household and share its code instead.',
                    action: PButton(
                      label: 'Go back',
                      variant: PButtonVariant.secondary,
                      onPressed: () => context.go(AppRoutes.firstRun),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
