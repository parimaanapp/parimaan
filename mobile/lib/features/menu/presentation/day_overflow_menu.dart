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
import 'weekly_plan_screen.dart' show weekdayNames;

/// The Weekly plan screen's per-day Overflow menu (W14 S8,
/// E2E_MVP_PLAN.md §20.2.8/§20.3): "Clear day" and "Copy to next day". Same
/// modal-bottom-sheet shape as `WeekOverflowMenu`/`RecipeOverflowMenu` — see
/// `WeekOverflowMenu`'s own doc for why a bottom sheet, not a
/// `PopupMenuButton`.
///
/// **"Copy to next day" (not an arbitrary source/target day picker) is this
/// slice's own placement call**, same flagged-not-locked posture as
/// `WeekOverflowMenu`'s own doc: `Mutation.copyMenuDay` itself accepts any
/// `(fromDay, toDay)` pair, but the wireframe gives no day-picker asset to
/// build against, and "copy to tomorrow" is the one day-to-day copy a
/// weekly-planning screen's own day section can express with no extra UI —
/// wrapping around from Sunday (day 6) to Monday (day 0).
class DayOverflowMenu extends ConsumerStatefulWidget {
  const DayOverflowMenu({
    super.key,
    required this.menuKey,
    required this.dayOfWeek,
  });

  final MenuKey menuKey;
  final int dayOfWeek;

  static const Key clearDayRowKey = Key('day-overflow-clear-day');
  static const Key copyToNextDayRowKey = Key('day-overflow-copy-next-day');
  static const Key errorKey = Key('day-overflow-error');

  @override
  ConsumerState<DayOverflowMenu> createState() => _DayOverflowMenuState();
}

class _DayOverflowMenuState extends ConsumerState<DayOverflowMenu> {
  bool _isBusy = false;
  String? _errorMessage;

  int get _nextDayOfWeek => (widget.dayOfWeek + 1) % 7;

  Future<void> _clearDay() async {
    final String dayName = weekdayNames[widget.dayOfWeek];
    final bool confirmed = await showClearCopyConfirmDialog(
      context: context,
      title: 'Clear $dayName?',
      body:
          "Removes every planned meal on $dayName that hasn't been made "
          'yet. Meals already marked made are always kept.',
      confirmLabel: 'Clear day',
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
          .clearMenuDay(widget.dayOfWeek);
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
        _errorMessage = 'Could not clear $dayName. Please try again.';
      });
      return;
    }
  }

  Future<void> _copyToNextDay() async {
    final String fromDayName = weekdayNames[widget.dayOfWeek];
    final String toDayName = weekdayNames[_nextDayOfWeek];
    final bool confirmed = await showClearCopyConfirmDialog(
      context: context,
      title: 'Copy $fromDayName to $toDayName?',
      body:
          "Copies every planned meal from $fromDayName onto $toDayName. A "
          'meal that doesn\'t fit, or would overwrite an already-made '
          'meal, is skipped rather than forced.',
      confirmLabel: 'Copy to $toDayName',
    );
    if (!confirmed || !mounted) return;

    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      final CopyMenuResult result = await ref
          .read(currentMenuControllerProvider(widget.menuKey).notifier)
          .copyMenuDay(widget.dayOfWeek, _nextDayOfWeek);
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
        _errorMessage = 'Could not copy to $toDayName. Please try again.';
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
              key: DayOverflowMenu.clearDayRowKey,
              label: 'Clear day',
              isDanger: true,
              isLoading: _isBusy,
              onTap: _isBusy ? null : _clearDay,
            ),
            _OverflowRow(
              key: DayOverflowMenu.copyToNextDayRowKey,
              label: 'Copy to ${weekdayNames[_nextDayOfWeek]}',
              isLoading: _isBusy,
              onTap: _isBusy ? null : _copyToNextDay,
            ),
            if (_errorMessage != null) ...<Widget>[
              const SizedBox(height: AppSpacing.s1),
              Text(
                _errorMessage!,
                key: DayOverflowMenu.errorKey,
                style: AppTypography.label.copyWith(color: AppColors.danger),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

/// Same row shape as `WeekOverflowMenu`'s own private `_OverflowRow` —
/// duplicated rather than shared for the same file-privacy reason that
/// file's own doc gives.
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
