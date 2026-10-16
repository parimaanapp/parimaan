import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../data/household_repository.dart';
import '../../domain/household.dart';
import '../../state/active_household_selection_controller.dart';
import '../../state/current_household_controller.dart';
import '../../state/current_user_id_controller.dart';
import '../../state/me_households_controller.dart';

/// The server's per-user household cap, mirrored from
/// `api/src/resolvers/createHousehold.ts`'s `MAX_HOUSEHOLDS_PER_USER`.
const int maxHouseholdsPerUser = 5;

/// How many members a household has, read once per row.
///
/// `Query.me` returns each household without its roster, so the count needs
/// the household's own read. A plain autoDispose future (no live subscription)
/// keeps a five-row list from opening five push channels.
final AutoDisposeFutureProviderFamily<int, String>
householdMemberCountProvider = FutureProvider.autoDispose.family<int, String>((
  Ref ref,
  String householdId,
) async {
  final Household household = await ref
      .read(householdRepositoryProvider)
      .fetchHousehold(householdId);
  return household.members.length;
});

/// Lists every household the user belongs to and lets them switch the active
/// one. Reached from the "You belong to N households" / "Household" rows in
/// Settings.
///
/// Switching persists the choice, invalidates all household-scoped state (see
/// [ActiveHouseholdSelectionController.select]) and returns to Today.
class HouseholdListScreen extends ConsumerWidget {
  const HouseholdListScreen({super.key});

  static const Key capNoticeKey = Key('household-list-cap-notice');
  static const Key errorKey = Key('household-list-error');
  static const Key activeBadgeKey = Key('household-list-active-badge');

  static Key rowKey(String householdId) => Key('household-row-$householdId');
  static Key switchKey(String householdId) =>
      Key('household-switch-$householdId');

  Future<void> _switchTo(
    BuildContext context,
    WidgetRef ref,
    Household household,
  ) async {
    final bool ok = await ref
        .read(activeHouseholdSelectionControllerProvider.notifier)
        .select(household.id);
    if (ok && context.mounted) {
      context.go(AppRoutes.home);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<Household>> households = ref.watch(
      meHouseholdsControllerProvider,
    );
    final Household? active = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'Households',
              onBack: () => context.go(
                active == null
                    ? AppRoutes.home
                    : AppRoutes.settingsHub(active.id),
              ),
              backSemanticLabel: 'Back to settings',
            ),
            Expanded(
              child: switch ((households.valueOrNull, households.error)) {
                (final List<Household> list, _) => _List(
                  households: list,
                  activeId: active?.id,
                  onSwitch: (Household h) => _switchTo(context, ref, h),
                ),
                (null, final Object _) => Center(
                  key: errorKey,
                  child: PEmptyState(
                    headline: 'Could not load your households',
                    body: 'Check your connection and try again.',
                    action: PButton(
                      label: 'Try again',
                      variant: PButtonVariant.secondary,
                      onPressed: () => ref
                          .read(meHouseholdsControllerProvider.notifier)
                          .refresh(),
                    ),
                  ),
                ),
                _ => const Center(child: CircularProgressIndicator()),
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _List extends ConsumerWidget {
  const _List({
    required this.households,
    required this.activeId,
    required this.onSwitch,
  });

  final List<Household> households;
  final String? activeId;
  final void Function(Household) onSwitch;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? userId = ref
        .watch(currentUserIdControllerProvider)
        .valueOrNull;
    final bool atCap = households.length >= maxHouseholdsPerUser;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.s3,
        0,
        AppSpacing.s3,
        AppSpacing.s3,
      ),
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.s2),
          child: Text(
            'You are in ${households.length} of $maxHouseholdsPerUser '
            'households.',
            style: AppTypography.label.copyWith(color: AppColors.inkMid),
          ),
        ),
        for (final Household household in households)
          _HouseholdRow(
            household: household,
            isActive: household.id == activeId,
            isPrimary: userId != null && household.isPrimary(userId),
            roleKnown: userId != null,
            onSwitch: () => onSwitch(household),
          ),
        if (atCap)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s1),
            child: Text(
              'You have reached the limit of $maxHouseholdsPerUser '
              'households. Leave one to create or join another.',
              key: HouseholdListScreen.capNoticeKey,
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
          ),
      ],
    );
  }
}

class _HouseholdRow extends ConsumerWidget {
  const _HouseholdRow({
    required this.household,
    required this.isActive,
    required this.isPrimary,
    required this.roleKnown,
    required this.onSwitch,
  });

  final Household household;
  final bool isActive;
  final bool isPrimary;
  final bool roleKnown;
  final VoidCallback onSwitch;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int? count = ref
        .watch(householdMemberCountProvider(household.id))
        .valueOrNull;
    final String membersText = count == null
        ? ''
        : '$count ${count == 1 ? 'member' : 'members'}';
    final String roleText = !roleKnown
        ? ''
        : (isPrimary ? 'Primary' : 'Member');
    final String meta = <String>[
      membersText,
      roleText,
    ].where((String s) => s.isNotEmpty).join(' · ');

    return Padding(
      key: HouseholdListScreen.rowKey(household.id),
      padding: const EdgeInsets.only(bottom: AppSpacing.s1),
      child: PCard(
        onTap: isActive ? null : onSwitch,
        semanticLabel: isActive
            ? '${household.name}, active household'
            : 'Switch to ${household.name}',
        child: Row(
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    household.name,
                    style: AppTypography.body.copyWith(color: AppColors.ink),
                  ),
                  if (meta.isNotEmpty)
                    Text(
                      meta,
                      style: AppTypography.label.copyWith(
                        color: AppColors.inkMid,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.s2),
            if (isActive)
              const PBadge(
                key: HouseholdListScreen.activeBadgeKey,
                label: 'Active',
                tone: PBadgeTone.success,
              )
            else
              PButton(
                key: HouseholdListScreen.switchKey(household.id),
                label: 'Switch',
                // Filled variant: its label is 18.7px (WCAG large text).
                onPressed: onSwitch,
              ),
          ],
        ),
      ),
    );
  }
}
