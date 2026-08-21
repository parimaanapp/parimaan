import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../../auth/domain/auth_session.dart';
import '../../../auth/state/auth_controller.dart';
import '../../domain/household.dart';
import '../../state/current_household_controller.dart';
import '../../state/household_settings_controller.dart';
import '../household_error_copy.dart';
import 'delete_household_dialog.dart';
import 'household_sync_scope.dart';
import 'settings_row.dart';

/// Wireframe screen 4.1 — the Settings hub.
///
/// ## Two rows the wireframe does not draw
///
/// **Leave household** and **Delete household** are here by a locked planning
/// decision, not by omission from the design. The wireframe has no home for
/// either, and both mutations exist and are reachable from nowhere else — a
/// shipped `leaveHousehold` with no UI is a feature that does not exist.
///
/// Their visibility is role-dependent, and asymmetrically so:
///
///  * **Leave** is *absent entirely* for the primary. The server refuses a
///    primary's leave with `FORBIDDEN`, so rendering the row — even disabled —
///    would advertise an action that can never succeed for this user. The one
///    exit for a primary is Delete, which is right below it.
///  * **Delete** is *absent entirely* for a non-primary, for the same reason
///    in reverse.
///
/// So the two rows are mutually exclusive: every member sees exactly one of
/// them, and it is the one that works for them.
///
/// ## The four preference rows reuse the wizard's own screens
///
/// "Meal structure", "Cuisine preferences", "Dietary tags" and "Allergens &
/// skip list" navigate to the *same widgets* the create wizard uses, entered in
/// [WizardFlow.edit]. See `presentation/create/wizard_flow.dart` for the
/// adapter and for why "Dietary tags" and "Allergens & skip list" — two rows
/// here — both land on the single screen 2.6 that owns both.
class SettingsHubScreen extends ConsumerWidget {
  const SettingsHubScreen({super.key, required this.householdId});

  final String householdId;

  static const Key householdRowKey = Key('settings-household');
  static const Key membersRowKey = Key('settings-members');
  static const Key mealStructureRowKey = Key('settings-meal-structure');
  static const Key cuisineRowKey = Key('settings-cuisine');
  static const Key dietaryRowKey = Key('settings-dietary');
  static const Key allergensRowKey = Key('settings-allergens');
  static const Key notificationsRowKey = Key('settings-notifications');
  static const Key aboutRowKey = Key('settings-about');
  static const Key leaveRowKey = Key('settings-leave');
  static const Key deleteRowKey = Key('settings-delete');
  static const Key signOutRowKey = Key('settings-sign-out');
  static const Key errorKey = Key('settings-error');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Household> household = ref.watch(
      currentHouseholdControllerProvider(householdId),
    );

    return HouseholdSyncScope(
      householdId: householdId,
      child: Scaffold(
        backgroundColor: AppColors.paper,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              PTopBar(
                title: 'Settings',
                onBack: () => context.go(AppRoutes.home),
                backSemanticLabel: 'Back to home',
              ),
              Expanded(
                // A value, if there is one, always wins: a failed poll keeps
                // the previous household underneath (see
                // `CurrentHouseholdController.refresh`), and that stale-but-
                // real roster is far more useful than a spinner or an error
                // page replacing a screen the user is reading.
                //
                // `valueOrNull`, not `value`: the latter rethrows on an
                // `AsyncError`, which would turn a load failure into a
                // redscreen instead of the empty state below.
                child: switch ((household.valueOrNull, household.error)) {
                  (final Household value, _) => _HubBody(
                    household: value,
                    error: household.error,
                  ),
                  (null, final Object error) => _LoadFailed(error: error),
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

class _HubBody extends ConsumerWidget {
  const _HubBody({required this.household, this.error});

  final Household household;

  /// A *refresh* failure layered over a good household — rendered as a line,
  /// not as a page, because the content behind it is still valid.
  final Object? error;

  Future<void> _leave(BuildContext context, WidgetRef ref) async {
    final bool ok = await ref
        .read(householdSettingsControllerProvider.notifier)
        .leaveHousehold(household.id);
    if (ok && context.mounted) {
      context.go(AppRoutes.firstRun);
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final bool deleted = await showDeleteHouseholdDialog(
      context: context,
      householdId: household.id,
      householdName: household.name,
    );
    if (deleted && context.mounted) {
      context.go(AppRoutes.firstRun);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // `AuthSession` is sealed, so this is exhaustive and type-safe — no cast.
    final String? userId = switch (ref
        .watch(authControllerProvider)
        .valueOrNull) {
      SignedIn(:final String userId) => userId,
      _ => null,
    };

    // An unresolved session is treated as "not the primary", which is the
    // safe default: it hides Delete rather than offering an irreversible
    // action to a caller whose identity is not established.
    final bool isPrimary = userId != null && household.isPrimary(userId);

    final AsyncValue<void> settings = ref.watch(
      householdSettingsControllerProvider,
    );
    final HouseholdSettingsAction action = ref
        .read(householdSettingsControllerProvider.notifier)
        .action;
    final String? actionError = householdErrorMessage(settings.error);
    final String? refreshError = householdErrorMessage(error);

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.s3,
        0,
        AppSpacing.s3,
        AppSpacing.s3,
      ),
      children: <Widget>[
        if (refreshError != null) _InlineNotice(message: refreshError),
        SettingsRow(
          key: SettingsHubScreen.householdRowKey,
          label: 'Household',
          value: household.name,
          // The household's own name is edited on wizard screen 2.1, which
          // creates rather than renames — there is no rename mutation in the
          // schema, so this row shows the name and does not pretend to edit it.
          onTap: null,
        ),
        SettingsRow(
          key: SettingsHubScreen.membersRowKey,
          label: 'Members (${household.members.length})',
          onTap: () => context.go(AppRoutes.members(household.id)),
        ),
        SettingsRow(
          key: SettingsHubScreen.mealStructureRowKey,
          label: 'Meal structure',
          onTap: () => context.go(AppRoutes.editMealStructure(household.id)),
        ),
        SettingsRow(
          key: SettingsHubScreen.cuisineRowKey,
          label: 'Cuisine preferences',
          onTap: () => context.go(AppRoutes.editCuisine(household.id)),
        ),
        SettingsRow(
          key: SettingsHubScreen.dietaryRowKey,
          label: 'Dietary tags',
          onTap: () => context.go(AppRoutes.editDietary(household.id)),
        ),
        SettingsRow(
          key: SettingsHubScreen.allergensRowKey,
          label: 'Allergens & skip list',
          // Screen 2.6 owns dietary tags, allergens and the skip list together
          // — one server patch, one screen. Two rows, one destination.
          onTap: () => context.go(AppRoutes.editDietary(household.id)),
        ),
        SettingsRow(
          key: SettingsHubScreen.notificationsRowKey,
          label: 'Notifications',
          onTap: () =>
              context.go(AppRoutes.settingsNotifications(household.id)),
        ),
        SettingsRow(
          key: SettingsHubScreen.aboutRowKey,
          label: 'About Parimaan',
          onTap: () => context.go(AppRoutes.settingsAbout(household.id)),
        ),
        if (actionError != null) ...<Widget>[
          const SizedBox(height: AppSpacing.s1),
          Text(
            actionError,
            key: SettingsHubScreen.errorKey,
            style: AppTypography.label.copyWith(color: AppColors.danger),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
        // Exactly one of these two renders. See the class doc.
        if (!isPrimary)
          SettingsRow(
            key: SettingsHubScreen.leaveRowKey,
            label: 'Leave household',
            isDanger: true,
            isLoading:
                settings.isLoading && action == HouseholdSettingsAction.leave,
            onTap: () => _leave(context, ref),
          )
        else
          SettingsRow(
            key: SettingsHubScreen.deleteRowKey,
            label: 'Delete household',
            isDanger: true,
            isLoading:
                settings.isLoading && action == HouseholdSettingsAction.delete,
            onTap: () => _delete(context, ref),
          ),
        SettingsRow(
          key: SettingsHubScreen.signOutRowKey,
          label: 'Sign out',
          isDanger: true,
          onTap: () => ref.read(authControllerProvider.notifier).signOut(),
        ),
      ],
    );
  }
}

/// A refresh failure shown above still-valid content.
class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s1),
    child: Text(
      message,
      key: SettingsHubScreen.errorKey,
      style: AppTypography.label.copyWith(color: AppColors.danger),
    ),
  );
}

/// The household could not be read at all — no stale value to fall back on.
class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context) => Center(
    child: PEmptyState(
      headline: 'Could not load this household',
      body: householdErrorMessage(error) ?? '',
      action: PButton(
        label: 'Back to home',
        variant: PButtonVariant.secondary,
        onPressed: () => context.go(AppRoutes.home),
      ),
    ),
  );
}
