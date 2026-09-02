import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/sizing.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/notification_preferences.dart';
import '../../state/notification_preferences_controller.dart';
import '../household_error_copy.dart';

/// One row's static copy — the field it controls, its label, and what it
/// means. Table-driven rather than four hand-written `_ToggleRow` call
/// sites: the plan's own RED-test list calls out "the four toggles map to
/// the four fields with no transposition" as exactly the bug this shape is
/// meant to make structurally hard to introduce (a mismatched label/field
/// pair would be a wrong entry in this one list, not a copy-paste slip
/// spread across four call sites).
class _RowSpec {
  const _RowSpec(this.field, this.label, this.meaning);

  final NotificationPreferenceField field;
  final String label;

  /// What this toggle governs, in one sentence — read by screen readers
  /// alongside the not-yet-active caveat below.
  final String meaning;
}

const List<_RowSpec> _rows = <_RowSpec>[
  _RowSpec(
    NotificationPreferenceField.listChanges,
    'List changes',
    'Alerts when a co-member adds to or edits the shopping list.',
  ),
  _RowSpec(
    NotificationPreferenceField.mealReminder,
    'Meal reminders',
    'A reminder near each meal time to check what is planned.',
  ),
  _RowSpec(
    NotificationPreferenceField.expiry,
    'Expiry warnings',
    'Alerts when a pantry item is close to its expiry date.',
  ),
  _RowSpec(
    NotificationPreferenceField.activity,
    'Household activity',
    'Alerts for joins, leaves, and other household-level changes.',
  ),
];

/// Because push is W20, not yet: every toggle's saved value round-trips
/// correctly today, but nothing sends a push until then. The
/// `settings_placeholder_screen.dart` honesty posture, carried down to
/// field level instead of screen level.
const String _notYetActiveCaveat =
    'Takes effect once push notifications are turned on.';

/// Wireframe screen 4.3 — the real four-toggle Notifications screen,
/// replacing `SettingsPlaceholderScreen.notifications` (W8 S9).
class NotificationPreferencesScreen extends ConsumerWidget {
  const NotificationPreferencesScreen({super.key, required this.householdId});

  final String householdId;

  static const Key errorKey = Key('notification-preferences-error');
  static Key toggleKey(NotificationPreferenceField field) =>
      Key('notification-preferences-toggle-${field.name}');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<NotificationPreferences> prefs = ref.watch(
      notificationPreferencesControllerProvider(householdId),
    );

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'Notifications',
              onBack: () => context.go(AppRoutes.settingsHub(householdId)),
              backSemanticLabel: 'Back to settings',
            ),
            Expanded(
              child: switch ((prefs.valueOrNull, prefs.error)) {
                (final NotificationPreferences value, _) => _PrefsBody(
                  householdId: householdId,
                  prefs: value,
                  error: prefs.error,
                ),
                (null, final Object error) => _LoadFailed(
                  householdId: householdId,
                  error: error,
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

class _PrefsBody extends ConsumerWidget {
  const _PrefsBody({
    required this.householdId,
    required this.prefs,
    this.error,
  });

  final String householdId;
  final NotificationPreferences prefs;

  /// A revert-on-error failure layered over the (now reverted) good value —
  /// rendered as a line, not as a page, same reasoning as
  /// `SettingsHubScreen`'s own inline notice.
  final Object? error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? errorMessage = householdErrorMessage(error);

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.s3,
        AppSpacing.s2,
        AppSpacing.s3,
        AppSpacing.s3,
      ),
      children: <Widget>[
        if (errorMessage != null) ...<Widget>[
          Text(
            errorMessage,
            key: NotificationPreferencesScreen.errorKey,
            style: AppTypography.label.copyWith(color: AppColors.danger),
          ),
          const SizedBox(height: AppSpacing.s2),
        ],
        for (final _RowSpec row in _rows) ...<Widget>[
          _ToggleRow(
            spec: row,
            value: prefs.valueOf(row.field),
            onChanged: (bool _) => ref
                .read(
                  notificationPreferencesControllerProvider(householdId)
                      .notifier,
                )
                .toggle(row.field),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
      ],
    );
  }
}

class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.spec,
    required this.value,
    required this.onChanged,
  });

  final _RowSpec spec;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => PCard(
    // No `onTap`: unlike `SettingsRow`'s navigational cards, this card is
    // not itself a tap target — the `Switch` inside is. `PCard` ignores
    // `semanticLabel` entirely when `onTap` is null (see its own `build`),
    // so the a11y label lives on the `Semantics` wrapper around the
    // `Switch` below instead.
    child: ConstrainedBox(
      constraints: const BoxConstraints(
        minHeight: AppSizing.minTouchTargetHeight,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(spec.label, style: AppTypography.body),
                const SizedBox(height: 2),
                Text(
                  _notYetActiveCaveat,
                  style: AppTypography.meta.copyWith(color: AppColors.inkMid),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.s2),
          Semantics(
            // `excludeSemantics: true` discards the `Switch`'s OWN semantics
            // node entirely — including its `SemanticsAction.tap`, the
            // action TalkBack/VoiceOver invoke on double-tap-to-activate.
            // Without `onTap` here to replace it, a screen-reader user would
            // hear this row's label and state correctly but have no way to
            // actually toggle it — inoperable, not just under-labelled.
            excludeSemantics: true,
            toggled: value,
            label: '${spec.label}. ${spec.meaning} $_notYetActiveCaveat',
            onTap: () => onChanged(!value),
            child: Switch(
              key: NotificationPreferencesScreen.toggleKey(spec.field),
              value: value,
              activeThumbColor: AppColors.terracotta,
              onChanged: onChanged,
            ),
          ),
        ],
      ),
    ),
  );
}

/// The preferences could not be read at all — no stale value to fall back on.
class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.householdId, required this.error});

  final String householdId;
  final Object error;

  @override
  Widget build(BuildContext context) => Center(
    child: PEmptyState(
      headline: 'Could not load notification preferences',
      body: householdErrorMessage(error) ?? '',
      action: PButton(
        label: 'Back to settings',
        variant: PButtonVariant.secondary,
        onPressed: () => context.go(AppRoutes.settingsHub(householdId)),
      ),
    ),
  );
}
