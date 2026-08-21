import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/radius.dart';
import '../../../../shared/ui/sizing.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../../auth/domain/auth_session.dart';
import '../../../auth/state/auth_controller.dart';
import '../../domain/household.dart';
import '../../domain/member_avatar.dart';
import '../../state/current_household_controller.dart';
import '../household_error_copy.dart';
import 'household_sync_scope.dart';

/// Wireframe screen 4.2 — the Members list.
///
/// Avatar circle + name + role, one row per membership, with the invite code in
/// a dashed-bordered share area at the bottom. The trailing "+" in the top bar
/// and the share area both lead to the same place: the invite-code screen the
/// create-wizard slice already built (`presentation/create/invite_code_screen.dart`),
/// reused rather than reimplemented.
///
/// Avatar colours come from `domain/member_avatar.dart` — a deterministic
/// hash of the user id into five existing `AppColors` tokens. See that file for
/// why the scheme had to be invented and why it seeds on the id rather than the
/// name.
class MembersListScreen extends ConsumerWidget {
  const MembersListScreen({super.key, required this.householdId});

  final String householdId;

  static const Key addButtonKey = Key('members-add');
  static const Key shareCodeKey = Key('members-share-code');

  static Key rowKey(String membershipId) => Key('members-row-$membershipId');

  static Key overflowKey(String membershipId) =>
      Key('members-overflow-$membershipId');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Household> household = ref.watch(
      currentHouseholdControllerProvider(householdId),
    );
    final String? userId = switch (ref
        .watch(authControllerProvider)
        .valueOrNull) {
      SignedIn(:final String userId) => userId,
      _ => null,
    };

    return HouseholdSyncScope(
      householdId: householdId,
      child: Scaffold(
        backgroundColor: AppColors.paper,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              PTopBar(
                title: 'Members',
                onBack: () => context.go(AppRoutes.settingsHub(householdId)),
                backSemanticLabel: 'Back to settings',
                trailing: PButton.icon(
                  key: addButtonKey,
                  icon: Icons.add,
                  semanticLabel: 'Share the invite code',
                  variant: PButtonVariant.ghost,
                  onPressed: () => context.go(AppRoutes.createHouseholdInvite),
                ),
              ),
              Expanded(
                // Same precedence, and the same `valueOrNull`-not-`value`
                // reasoning, as the Settings hub.
                child: switch ((household.valueOrNull, household.error)) {
                  (final Household value, _) => _Roster(
                    household: value,
                    currentUserId: userId,
                    error: household.error,
                  ),
                  (null, final Object error) => Center(
                    child: PEmptyState(
                      headline: 'Could not load members',
                      body: householdErrorMessage(error) ?? '',
                      action: PButton(
                        label: 'Back to settings',
                        variant: PButtonVariant.secondary,
                        onPressed: () =>
                            context.go(AppRoutes.settingsHub(householdId)),
                      ),
                    ),
                  ),
                  _ => const Center(child: CircularProgressIndicator()),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Roster extends StatelessWidget {
  const _Roster({
    required this.household,
    required this.currentUserId,
    this.error,
  });

  final Household household;
  final String? currentUserId;
  final Object? error;

  @override
  Widget build(BuildContext context) {
    final String? message = householdErrorMessage(error);

    return Column(
      children: <Widget>[
        if (message != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.s3,
              0,
              AppSpacing.s3,
              AppSpacing.s1,
            ),
            child: Text(
              message,
              style: AppTypography.label.copyWith(color: AppColors.danger),
            ),
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
            children: <Widget>[
              for (final HouseholdMembership membership in household.members)
                _MemberRow(
                  membership: membership,
                  isCurrentUser: membership.user.id == currentUserId,
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.s3),
          child: _ShareCodeArea(inviteCode: household.inviteCode),
        ),
      ],
    );
  }
}

class _MemberRow extends StatelessWidget {
  const _MemberRow({required this.membership, required this.isCurrentUser});

  final HouseholdMembership membership;
  final bool isCurrentUser;

  /// "primary · you" / "primary" / "member · you" / "member", per the
  /// wireframe. The role comes first because it is the thing that differs
  /// between rows; "you" is the qualifier.
  String get _roleLabel {
    final String role = membership.role == HouseholdRole.primary
        ? 'primary'
        : 'member';
    return isCurrentUser ? '$role · you' : role;
  }

  @override
  Widget build(BuildContext context) {
    final String label = membership.user.label;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s1),
      child: PCard(
        key: MembersListScreen.rowKey(membership.id),
        semanticLabel: '$label, $_roleLabel',
        child: Row(
          children: <Widget>[
            _Avatar(seed: membership.user.id, label: label),
            const SizedBox(width: AppSpacing.s2),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    label,
                    style: AppTypography.bodyStrong.copyWith(
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.s0),
                  Text(
                    _roleLabel,
                    style: AppTypography.label.copyWith(
                      color: AppColors.inkMid,
                    ),
                  ),
                ],
              ),
            ),
            // The wireframe draws an overflow affordance on non-primary rows
            // and specifies no actions behind it. Rendering it disabled — a
            // real, visible, non-interactive control — is the honest shape: no
            // menu is invented, and a tap does not silently do nothing.
            //
            // `semanticLabel` alone reaches screen-reader users but not
            // sighted ones — a greyed-out icon with no on-screen text leaves
            // a sighted user guessing why it doesn't respond. The `Tooltip`
            // (long-press on touch, hover on desktop/web) gives them the same
            // "coming soon" explanation without a permanent caption on every
            // row, which would be heavy in a list this dense.
            if (membership.role != HouseholdRole.primary)
              Tooltip(
                message: 'Coming soon',
                child: PButton.icon(
                  key: MembersListScreen.overflowKey(membership.id),
                  icon: Icons.more_horiz,
                  semanticLabel: 'More actions for $label — coming soon',
                  variant: PButtonVariant.ghost,
                  onPressed: null,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The coloured circle with a single initial.
class _Avatar extends StatelessWidget {
  const _Avatar({required this.seed, required this.label});

  static const double diameter = AppSizing.icon32 + AppSpacing.s0;

  final String seed;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    width: diameter,
    height: diameter,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: memberAvatarColor(seed),
      borderRadius: AppRadius.borderFull,
    ),
    child: Text(
      memberAvatarInitial(label),
      // Every palette colour is dark enough to carry `paper` as its
      // foreground — see `member_avatar.dart`.
      style: AppTypography.bodyStrong.copyWith(color: AppColors.paper),
    ),
  );
}

/// The dashed-bordered "Share invite code · {CODE}" area at the bottom.
///
/// The dashed stroke is the same design-system gap `invite_code_screen.dart`
/// already flagged: there is no dashed-border primitive, so this uses a solid
/// terracotta border at the same radius and weight. The plaque still reads as a
/// distinct, framed, brand-coloured object, which is what the dashes do.
/// Flagged rather than absorbed silently — and flagged in the same words as the
/// first occurrence, so the two are recognisably one gap and not two.
class _ShareCodeArea extends StatelessWidget {
  const _ShareCodeArea({required this.inviteCode});

  final String inviteCode;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Share invite code $inviteCode',
    child: GestureDetector(
      key: MembersListScreen.shareCodeKey,
      behavior: HitTestBehavior.opaque,
      onTap: () => context.go(AppRoutes.createHouseholdInvite),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s3,
          vertical: AppSpacing.s2,
        ),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: AppRadius.borderL,
          border: Border.all(color: AppColors.terracotta, width: 2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text(
              'Share invite code · ',
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
            Text(
              inviteCode,
              style: AppTypography.mono.copyWith(color: AppColors.terracotta),
            ),
          ],
        ),
      ),
    ),
  );
}
