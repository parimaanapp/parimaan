import 'package:flutter/material.dart';

import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/sizing.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';

/// One tappable row on the Settings hub (wireframe 4.1).
///
/// A composed [PCard], not a new component: the design system has no list-row
/// primitive, and the hub's rows are a card with a label, an optional trailing
/// value, and a chevron. Extracting it here rather than repeating the same
/// `PCard` + `Row` eleven times keeps the chevron, the touch target and the
/// danger styling in one place.
///
/// The chevron is suppressed for [isDanger] rows, per the wireframe: "Sign out"
/// and the two destructive actions are terminal, not navigational, and a
/// chevron would promise a screen that does not follow.
class SettingsRow extends StatelessWidget {
  const SettingsRow({
    super.key,
    required this.label,
    required this.onTap,
    this.value,
    this.isDanger = false,
    this.isLoading = false,
  });

  /// The design source's own chevron, matching `PTopBar.defaultBackGlyph`'s
  /// mirror so one glyph family means one thing across the app.
  static const String chevronGlyph = '›';

  final String label;

  /// The trailing summary — "Kulkarni Kitchen", "4" — or null.
  final String? value;

  /// `null` disables the row. A disabled row still renders (greyed) rather than
  /// disappearing, so the affordance's absence is explained rather than
  /// mysterious — except where the caller omits the row entirely, which is what
  /// the Settings hub does for a primary's "Leave household".
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
        semanticLabel: value == null ? label : '$label, $value',
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
              if (value != null) ...<Widget>[
                const SizedBox(width: AppSpacing.s2),
                Flexible(
                  child: Text(
                    value!,
                    textAlign: TextAlign.end,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.label.copyWith(
                      color: AppColors.inkMid,
                    ),
                  ),
                ),
              ],
              const SizedBox(width: AppSpacing.s1),
              if (isLoading)
                const SizedBox(
                  width: AppSizing.icon16,
                  height: AppSizing.icon16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else if (!isDanger)
                Text(
                  chevronGlyph,
                  style: AppTypography.body.copyWith(color: AppColors.inkMid),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
