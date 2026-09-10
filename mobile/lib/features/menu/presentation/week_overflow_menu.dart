import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/menu.dart';
import '../state/current_menu_controller.dart';
import 'clear_copy_confirm_dialog.dart';

/// The Weekly plan screen's week-level Overflow menu (W14 S8,
/// E2E_MVP_PLAN.md §20.2.8/§20.3): "Clear week" and "Copy to next week".
/// A modal bottom sheet, same shape/precedent as `RecipeOverflowMenu`
/// (that file's own doc: no `PopupMenuButton` primitive exists in
/// `shared/ui`, a bottom sheet matches this design system's row language
/// better than a compact dropdown for a small set of actions, one of them
/// destructive).
///
/// **Placement is a flagged judgment call** — the plan (§20.3, S8) leaves
/// affordance placement to this slice's own discretion. A week-level
/// overflow menu next to the existing "Auto-fill week"/"Generate shopping
/// list" trailing actions on `WeeklyPlanScreen`'s top bar was chosen
/// because both week-scoped actions here act on the SAME whole-week scope
/// those two already do, rather than adding two more always-visible icon
/// buttons to an already three-icon trailing row.
///
/// Each row is confirm-gated (`showClearCopyConfirmDialog`) and, on
/// confirm, calls exactly one `CurrentMenuController` mutation, then shows
/// a `SnackBar` with the mutation's own honest counts — including a
/// partial result (`skippedCount`/`preservedCount` > 0), never silently
/// rounded up to "success". Cancelling the confirm dialog calls nothing.
class WeekOverflowMenu extends ConsumerStatefulWidget {
  const WeekOverflowMenu({super.key, required this.menuKey});

  final MenuKey menuKey;

  static const Key clearWeekRowKey = Key('week-overflow-clear-week');
  static const Key copyToNextWeekRowKey = Key('week-overflow-copy-next-week');
  static const Key errorKey = Key('week-overflow-error');

  @override
  ConsumerState<WeekOverflowMenu> createState() => _WeekOverflowMenuState();
}

class _WeekOverflowMenuState extends ConsumerState<WeekOverflowMenu> {
  bool _isBusy = false;
  String? _errorMessage;

  Future<void> _clearWeek() async {
    final bool confirmed = await showClearCopyConfirmDialog(
      context: context,
      title: 'Clear this week?',
      body:
          "Removes every planned meal this week that hasn't been made yet. "
          'Meals already marked made are always kept.',
      confirmLabel: 'Clear week',
      isDestructive: true,
    );
    if (!confirmed || !mounted) return;

    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      final ClearMenuResult result = await ref
          .read(currentMenuControllerProvider(widget.menuKey).notifier)
          .clearMenuWeek();
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Cleared ${result.clearedCount}, kept ${result.preservedCount} already made.',
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isBusy = false;
        _errorMessage = 'Could not clear the week. Please try again.';
      });
      return;
    }
  }

  Future<void> _copyToNextWeek() async {
    final DateTime nextWeekStartDate = widget.menuKey.weekStartDate.add(
      const Duration(days: 7),
    );
    final bool confirmed = await showClearCopyConfirmDialog(
      context: context,
      title: 'Copy this week to next week?',
      body:
          "Copies every planned meal into next week's plan. A meal that "
          "doesn't fit next week's own settings, or would overwrite an "
          'already-made meal, is skipped rather than forced.',
      confirmLabel: 'Copy to next week',
    );
    if (!confirmed || !mounted) return;

    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      final CopyMenuResult result = await ref
          .read(currentMenuControllerProvider(widget.menuKey).notifier)
          .copyMenuWeek(nextWeekStartDate);
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Copied ${result.copiedCount}, skipped ${result.skippedCount}.',
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isBusy = false;
        _errorMessage = 'Could not copy to next week. Please try again.';
      });
      return;
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s3),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            _OverflowRow(
              key: WeekOverflowMenu.clearWeekRowKey,
              label: 'Clear week',
              isDanger: true,
              isLoading: _isBusy,
              onTap: _isBusy ? null : _clearWeek,
            ),
            _OverflowRow(
              key: WeekOverflowMenu.copyToNextWeekRowKey,
              label: 'Copy to next week',
              isLoading: _isBusy,
              onTap: _isBusy ? null : _copyToNextWeek,
            ),
            if (_errorMessage != null) ...<Widget>[
              const SizedBox(height: AppSpacing.s1),
              Text(
                _errorMessage!,
                key: WeekOverflowMenu.errorKey,
                style: AppTypography.label.copyWith(color: AppColors.danger),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

/// Same row shape as `RecipeOverflowMenu`'s own private `_OverflowRow` —
/// duplicated rather than shared, since that one is file-private and this
/// slice doesn't own `features/recipes/`.
class _OverflowRow extends StatelessWidget {
  const _OverflowRow({
    super.key,
    required this.label,
    required this.onTap,
    this.isDanger = false,
    this.isLoading = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool isDanger;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onTap != null && !isLoading;
    final Color labelColor = isDanger
        ? AppColors.danger
        : (enabled ? AppColors.ink : AppColors.inkMid);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s1),
      child: PCard(
        onTap: enabled ? onTap : null,
        semanticLabel: label,
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: AppSizing.minTouchTargetHeight,
          ),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  label,
                  style: AppTypography.body.copyWith(color: labelColor),
                ),
              ),
              if (isLoading)
                const SizedBox(
                  width: AppSizing.icon16,
                  height: AppSizing.icon16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
