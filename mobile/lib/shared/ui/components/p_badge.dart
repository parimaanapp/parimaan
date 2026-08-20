import 'package:flutter/material.dart';

import '../tokens.dart';

/// Badge tones. Each maps to a named token pair — there is no alpha ramp in the
/// token set, so tinted surfaces use the nearest named surface colour.
enum PBadgeTone { neutral, success, warning, danger, info, accent }

/// A small, non-interactive status or count indicator.
///
/// **Provenance.** The design source has no section called "badge"; the
/// closest thing it draws is the "AI suggests" pill on the confirm-before-write
/// modal — a `radius.r-full` pill carrying tracked all-caps `meta` type on a
/// tinted surface. That pill is the spec this component generalises, which is
/// why the default is uppercase meta type in a pill rather than, say, a
/// Material-style numeric dot.
///
/// A badge is **status, never a control**: it takes no callback, and nothing
/// here is tappable. If it needs to be pressed it is a [PChip] or a
/// `PButton`, not a badge — which is also why the 44pt touch-target floor does
/// not apply.
///
/// [label] is always rendered, so the tone's colour is never the only signal.
class PBadge extends StatelessWidget {
  const PBadge({
    super.key,
    required this.label,
    this.tone = PBadgeTone.neutral,
    this.icon,
    this.uppercase = true,
  }) : _isMono = false;

  /// A numeric badge — unread counts, item counts.
  ///
  /// Renders in [AppTypography.mono], the face the design system reserves for
  /// "codes, dense quantities, timestamps".
  const PBadge.count({
    super.key,
    required int count,
    this.tone = PBadgeTone.neutral,
    this.icon,
  }) : assert(count >= 0, 'A count badge cannot be negative'),
       label = '$count',
       uppercase = false,
       _isMono = true;

  /// Visible badge copy, supplied by the caller.
  final String label;

  final PBadgeTone tone;

  /// Optional leading glyph, passed in by the caller so this library never
  /// hard-codes an icon set.
  final IconData? icon;

  /// Uppercase the label, per the `meta` type token's `"transform"` rule.
  /// [TextStyle] cannot transform case, so the widget does it.
  final bool uppercase;

  final bool _isMono;

  @override
  Widget build(BuildContext context) {
    final _PBadgeColors colors = _colorsFor(tone);
    final String text = uppercase ? label.toUpperCase() : label;

    return Container(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: AppRadius.borderFull,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.s1,
        vertical: AppSpacing.s0,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: AppSizing.icon16, color: colors.foreground),
            const SizedBox(width: AppSpacing.s0),
          ],
          Text(
            text,
            style: (_isMono ? AppTypography.mono : AppTypography.meta).copyWith(
              color: colors.foreground,
            ),
          ),
        ],
      ),
    );
  }
}

@immutable
class _PBadgeColors {
  const _PBadgeColors({required this.background, required this.foreground});

  final Color background;
  final Color foreground;
}

_PBadgeColors _colorsFor(PBadgeTone tone) {
  switch (tone) {
    case PBadgeTone.neutral:
      return const _PBadgeColors(
        background: AppColors.paper2,
        foreground: AppColors.inkSoft,
      );
    case PBadgeTone.success:
      return const _PBadgeColors(
        background: AppColors.cardamomSoft,
        foreground: AppColors.cardamomSoftForeground,
      );
    case PBadgeTone.warning:
      return const _PBadgeColors(
        background: AppColors.haldiSoft,
        foreground: AppColors.ink,
      );
    case PBadgeTone.danger:
      return const _PBadgeColors(
        background: AppColors.danger,
        foreground: AppColors.paper,
      );
    case PBadgeTone.info:
      return const _PBadgeColors(
        background: AppColors.info,
        foreground: AppColors.paper,
      );
    case PBadgeTone.accent:
      return const _PBadgeColors(
        background: AppColors.terracotta,
        foreground: AppColors.paper,
      );
  }
}
