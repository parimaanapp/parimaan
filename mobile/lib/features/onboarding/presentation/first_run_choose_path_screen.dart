import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../household/domain/household.dart';
import '../../household/domain/household_name.dart';
import '../../household/state/create_household_controller.dart';

/// The first thing a newly signed-in user sees: create a household, or join one
/// somebody else already made.
///
/// Both paths are on one screen rather than behind a chooser, because with
/// exactly two options a chooser is a wasted tap and hides the fact that
/// creating needs a name.
class FirstRunChoosePathScreen extends ConsumerStatefulWidget {
  const FirstRunChoosePathScreen({super.key});

  static const Key nameFieldKey = Key('first-run-household-name');
  static const Key createButtonKey = Key('first-run-create');
  static const Key joinButtonKey = Key('first-run-join');

  /// Lets tests assert the *absence* of the server-error line, which
  /// `find.text` cannot express for copy that is conditionally built. Same
  /// trick as `SignInScreen.errorKey`.
  static const Key serverErrorKey = Key('first-run-server-error');

  /// The cold-start explanation, shown only while a create is in flight.
  static const Key coldStartHintKey = Key('first-run-cold-start-hint');

  /// Copy `PButton` swaps in for the label while loading. A constant so the
  /// widget test asserts the same string the widget renders.
  static const String createLoadingLabel = 'Setting up your kitchen…';

  /// Shown under the button during the wait.
  ///
  /// Aurora Serverless v2 auto-pause (PRD §17.4 lever #2, "non-negotiable" for
  /// cost) means the **first** request after a quiet period blocks for up to
  /// ~30s while the cluster resumes — documented in `docs/RUNBOOK.md` and
  /// `docs/SYSTEM_DESIGN.md`. A spinner alone reads as a hang at that
  /// duration, and a user who force-quits mid-mutation is the worst outcome
  /// available, so the wait is named rather than hidden.
  static const String coldStartHint =
      'This can take up to half a minute the first time — the kitchen is '
      'waking up. Please keep the app open.';

  @override
  ConsumerState<FirstRunChoosePathScreen> createState() =>
      _FirstRunChoosePathScreenState();
}

class _FirstRunChoosePathScreenState
    extends ConsumerState<FirstRunChoosePathScreen> {
  final TextEditingController _name = TextEditingController();

  /// The client-side validation message, or `null`. Set only on submit and
  /// cleared on edit: validating on every keystroke would shout "must not be
  /// empty" at someone who has simply not started typing.
  String? _validationError;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _onNameChanged(String _) {
    if (_validationError != null) {
      setState(() => _validationError = null);
    }
  }

  Future<void> _create() async {
    // Fast feedback only — the server is still the authority and still gets
    // called for everything this does not catch. See `household_name.dart`.
    final String? error = validateHouseholdName(_name.text);
    if (error != null) {
      setState(() => _validationError = error);
      return;
    }
    setState(() => _validationError = null);

    await ref
        .read(createHouseholdControllerProvider.notifier)
        .createHousehold(_name.text);

    if (!mounted) {
      return;
    }
    final AsyncValue<Household?> state = ref.read(
      createHouseholdControllerProvider,
    );
    if (state.valueOrNull != null) {
      // `/home` is still the placeholder from the auth slice; the real
      // post-creation destination (the week plan) is a later slice, and
      // routing there now would be routing at a screen that does not exist.
      context.go(AppRoutes.home);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Household?> state = ref.watch(
      createHouseholdControllerProvider,
    );
    final bool isBusy = state.isLoading;
    final String? serverError = _serverErrorMessage(state.error);

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
              _CreatePathCard(
                nameController: _name,
                validationError: _validationError,
                isBusy: isBusy,
                onNameChanged: _onNameChanged,
                onSubmit: _create,
              ),
              if (serverError != null) ...<Widget>[
                const SizedBox(height: AppSpacing.s3),
                Text(
                  serverError,
                  key: FirstRunChoosePathScreen.serverErrorKey,
                  style: AppTypography.label.copyWith(color: AppColors.danger),
                ),
              ],
              const SizedBox(height: AppSpacing.s5),
              _JoinPathCard(
                // Joining while a create is in flight would race two
                // household states against each other.
                onJoin: isBusy
                    ? null
                    : () => context.go(AppRoutes.joinHousehold),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Server-side failures rendered as themselves.
  ///
  /// Every branch is spelled out rather than collapsed into
  /// `error.errorMessage`: the exhaustive `switch` is what makes the compiler
  /// point here when `AppError` grows a variant, which is the entire reason
  /// the taxonomy is sealed.
  ///
  /// [UnauthorizedError] is the one case worth handling rather than only
  /// showing — `auth_link.dart` deliberately refuses to sign the user out from
  /// inside the link and leaves it to the caller. This screen is that caller;
  /// it currently only *explains* the state, because the sign-out is a
  /// navigation side effect and doing it from a build method would be wrong.
  /// Wiring it to `authController.signOut()` from an explicit "Sign in again"
  /// action is the right next step and belongs with the join flow slice.
  String? _serverErrorMessage(Object? error) => switch (error) {
    null => null,
    UnauthorizedError() => 'Your session has expired. Sign in again.',
    ForbiddenError(:final String errorMessage) => errorMessage,
    ValidationError(:final String errorMessage) => errorMessage,
    ConflictError(:final String errorMessage) => errorMessage,
    NotFoundError(:final String errorMessage) => errorMessage,
    HouseholdFullError(:final String errorMessage) => errorMessage,
    RateLimitedError(:final String errorMessage) => errorMessage,
    InternalError(:final String errorMessage) => errorMessage,
    // Not an `AppError` at all. `HouseholdRepository`'s contract says this
    // cannot happen, so rather than render a Dart exception's `toString` at a
    // user, fall back to the same generic copy the server uses.
    _ => genericErrorMessage,
  };
}

class _CreatePathCard extends StatelessWidget {
  const _CreatePathCard({
    required this.nameController,
    required this.validationError,
    required this.isBusy,
    required this.onNameChanged,
    required this.onSubmit,
  });

  final TextEditingController nameController;
  final String? validationError;
  final bool isBusy;
  final ValueChanged<String> onNameChanged;
  final Future<void> Function() onSubmit;

  @override
  Widget build(BuildContext context) {
    return PCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Create a household',
            style: AppTypography.title.copyWith(color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.s3),
          PInput(
            key: FirstRunChoosePathScreen.nameFieldKey,
            label: 'Household name',
            hintText: 'Kulkarni Kitchen',
            helperText: 'You can change this later.',
            errorText: validationError,
            controller: nameController,
            enabled: !isBusy,
            textInputAction: TextInputAction.done,
            onChanged: onNameChanged,
            onSubmitted: (String _) => onSubmit(),
          ),
          const SizedBox(height: AppSpacing.s4),
          PButton(
            key: FirstRunChoosePathScreen.createButtonKey,
            label: 'Create a household',
            // `PButton`'s own loading affordance: it swaps the content for a
            // spinner, shows `loadingLabel` instead of `label`, and makes
            // itself inert. Reused rather than reinvented.
            isLoading: isBusy,
            loadingLabel: FirstRunChoosePathScreen.createLoadingLabel,
            expand: true,
            onPressed: () => onSubmit(),
          ),
          if (isBusy) ...<Widget>[
            const SizedBox(height: AppSpacing.s3),
            Text(
              FirstRunChoosePathScreen.coldStartHint,
              key: FirstRunChoosePathScreen.coldStartHintKey,
              textAlign: TextAlign.center,
              style: AppTypography.label.copyWith(color: AppColors.inkSoft),
            ),
          ],
        ],
      ),
    );
  }
}

class _JoinPathCard extends StatelessWidget {
  const _JoinPathCard({required this.onJoin});

  final VoidCallback? onJoin;

  @override
  Widget build(BuildContext context) {
    return PCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Join a household',
            style: AppTypography.title.copyWith(color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.s2),
          Text(
            'Someone in your family already set one up? Use their invite code.',
            style: AppTypography.body.copyWith(color: AppColors.inkSoft),
          ),
          const SizedBox(height: AppSpacing.s4),
          PButton(
            key: FirstRunChoosePathScreen.joinButtonKey,
            label: 'Join a household',
            variant: PButtonVariant.secondary,
            expand: true,
            onPressed: onJoin,
          ),
        ],
      ),
    );
  }
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
