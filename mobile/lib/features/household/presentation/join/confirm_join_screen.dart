import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/household.dart';
import '../../state/household_settings_controller.dart';
import '../../state/join_household_controller.dart';
import '../household_error_copy.dart';

/// Wireframe screen 3.2 — the join confirmation.
///
/// ## This is a post-hoc confirmation, and that is deliberate
///
/// By the time this screen renders, the caller **is already a member**. See
/// `EnterCodeScreen`'s doc for the full reasoning; the short version is that
/// the schema has no way to resolve an invite code to a household without
/// joining, so a pre-flight version of this screen could only show the six
/// characters the user just typed — a confirmation carrying no information.
///
/// Because the join already happened, this screen can do what the wireframe
/// actually draws: show the household. Name, member count, dietary and cuisine
/// summary, all read straight from `joinHousehold`'s response — which is why
/// that mutation selects the whole `HouseholdFields` fragment.
///
/// ## The button pair, and why "Cancel" is a real undo
///
/// The wireframe draws a primary + ghost pair. The primary continues into the
/// app. The ghost is labelled for what it does — it **leaves** the household —
/// because a button labelled "Cancel" that cannot cancel anything would be a
/// lie: the membership row already exists.
///
/// That undo is only honest because `leaveHousehold` genuinely undoes this: it
/// is idempotent, needs nobody's permission, and the joiner is never the
/// primary (`api/src/resolvers/joinHousehold.ts` inserts `member`), so the
/// primary-cannot-leave refusal can never apply to this caller.
class ConfirmJoinScreen extends ConsumerWidget {
  const ConfirmJoinScreen({super.key});

  static const Key continueButtonKey = Key('confirm-join-continue');
  static const Key leaveButtonKey = Key('confirm-join-leave');
  static const Key summaryKey = Key('confirm-join-summary');
  static const Key noHouseholdKey = Key('confirm-join-missing');
  static const Key errorKey = Key('confirm-join-error');

  static const String heading = "You're in";

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref
        .watch(joinHouseholdControllerProvider)
        .valueOrNull;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s3),
          child: household == null
              ? const _NoHousehold(key: noHouseholdKey)
              : _JoinedBody(household: household),
        ),
      ),
    );
  }
}

class _JoinedBody extends ConsumerWidget {
  const _JoinedBody({required this.household});

  final Household household;

  Future<void> _leave(BuildContext context, WidgetRef ref) async {
    final bool ok = await ref
        .read(householdSettingsControllerProvider.notifier)
        .leaveHousehold(household.id);

    if (!context.mounted) {
      return;
    }
    if (ok) {
      // Back to the code field with the controller reset, so the flow reopens
      // clean rather than on the household just abandoned.
      ref.read(joinHouseholdControllerProvider.notifier).reset();
      context.go(AppRoutes.joinHousehold);
    }
    // A failed leave stays put and renders its message: the user is still a
    // member, and pretending otherwise would be worse than the error.
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> settings = ref.watch(
      householdSettingsControllerProvider,
    );
    final bool isLeaving = settings.isLoading;
    final String? error = householdErrorMessage(settings.error);

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          ConfirmJoinScreen.heading,
          textAlign: TextAlign.center,
          style: AppTypography.displayM.copyWith(color: AppColors.ink),
        ),
        const SizedBox(height: AppSpacing.s3),
        PCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                household.name,
                style: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
              ),
              const SizedBox(height: AppSpacing.s0),
              Text(
                householdSummaryLine(household),
                key: ConfirmJoinScreen.summaryKey,
                style: AppTypography.label.copyWith(color: AppColors.inkMid),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        if (error != null) ...<Widget>[
          Text(
            error,
            key: ConfirmJoinScreen.errorKey,
            style: AppTypography.label.copyWith(color: AppColors.danger),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
        PButton(
          key: ConfirmJoinScreen.continueButtonKey,
          label: 'Go to my household',
          expand: true,
          onPressed: isLeaving ? null : () => context.go(AppRoutes.home),
        ),
        const SizedBox(height: AppSpacing.s1),
        PButton(
          key: ConfirmJoinScreen.leaveButtonKey,
          // Named for what it does. See the class doc.
          label: 'Not this one — leave',
          variant: PButtonVariant.ghost,
          expand: true,
          isLoading: isLeaving,
          onPressed: () => _leave(context, ref),
        ),
      ],
    );
  }
}

/// The one-line household summary the wireframe draws under the name —
/// "4 members · veg · North + South Indian".
///
/// Reads the server's raw enum-value names out of `HouseholdSettings`, which
/// carries them as `List<String>` on purpose (see that class's doc). The
/// underscores are turned into spaces and the words title-cased for display
/// only; nothing here is ever sent back.
String householdSummaryLine(Household household) {
  final int memberCount = household.members.length;
  final List<String> parts = <String>[
    '$memberCount ${memberCount == 1 ? 'member' : 'members'}',
    ...household.settings.dietaryTags.take(2).map(_humanize),
    if (household.settings.cuisineTier1.isNotEmpty)
      household.settings.cuisineTier1.map(_humanize).join(' + '),
  ];
  return parts.join(' · ');
}

String _humanize(String wireValue) => wireValue
    .split('_')
    .map(
      (String word) =>
          word.isEmpty ? word : word[0].toUpperCase() + word.substring(1),
    )
    .join(' ');

/// What renders if this screen is reached without a join having happened — a
/// back-button return after the controller was reset, most plausibly.
///
/// An explicit way onward rather than a blank screen, per the design system's
/// "no dead ends" rule that makes `PEmptyState.action` required.
class _NoHousehold extends StatelessWidget {
  const _NoHousehold({super.key});

  @override
  Widget build(BuildContext context) => Center(
    child: PEmptyState(
      headline: 'Nothing to confirm',
      body:
          'This screen shows a household you have just joined, and no join has '
          'happened yet.',
      action: PButton(
        label: 'Enter an invite code',
        variant: PButtonVariant.secondary,
        onPressed: () => context.go(AppRoutes.joinHousehold),
      ),
    ),
  );
}
