import 'package:flutter/material.dart';

import '../tokens.dart';

/// The two chip shapes the design source draws.
enum PChipVariant {
  /// The pill: filter chips and role chips. On/off, tappable.
  filter,

  /// The small square-cornered tag: dietary flags, cook time, cuisine.
  /// Display-only unless a callback is supplied.
  tag,
}

/// Tag tints, each a named token pair from the design system.
///
/// The design source paints these with alpha-blended brand colours
/// (`rgba(79,107,74,0.12)` and friends); the token file has no alpha ramp, so
/// each tone maps to the nearest *named* surface/foreground pair instead of
/// inventing an opacity.
enum PChipTone { neutral, veg, warm, accent }

/// A Parimaan chip.
///
/// **Consumer rule, not enforceable here:** filter chips, role chips and
/// dietary tags only — *never* a chip for a primary action. A chip that
/// performs the screen's main action is a [PButton] wearing the wrong shape,
/// and no amount of API design can stop that; it is a review-time check.
///
/// Selection is signalled by an inverted surface **and** a tick glyph, never
/// by colour alone.
class PChip extends StatelessWidget {
  const PChip({
    super.key,
    required this.label,
    this.variant = PChipVariant.filter,
    this.tone = PChipTone.neutral,
    this.selected = false,
    this.onTap,
    this.onRemove,
    this.removeSemanticLabel,
  }) : assert(
         onRemove == null || removeSemanticLabel != null,
         'A remove control needs a screen-reader label — the glyph is not one.',
       );

  /// The tick shown on a selected filter chip.
  static const String selectedGlyph = '✓';

  /// The dismiss affordance on a removable chip.
  static const String removeGlyph = '×';

  /// Visible chip copy, supplied by the caller.
  final String label;

  final PChipVariant variant;
  final PChipTone tone;

  /// On/off state for filter and role chips.
  final bool selected;

  /// Non-null makes the chip tappable — and therefore subject to the 44pt
  /// touch-target floor.
  final VoidCallback? onTap;

  /// Non-null renders a dismiss affordance.
  final VoidCallback? onRemove;

  /// Required whenever [onRemove] is given.
  final String? removeSemanticLabel;

  bool get _isPill => variant == PChipVariant.filter;

  @override
  Widget build(BuildContext context) {
    final _PChipColors colors = _colorsFor(variant, tone, selected);

    final Widget body = Container(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: _isPill ? AppRadius.borderFull : AppRadius.borderXs,
        border: colors.border == null
            ? null
            : Border.fromBorderSide(BorderSide(color: colors.border!)),
      ),
      padding: EdgeInsets.symmetric(
        horizontal: _isPill ? AppSpacing.s2 : AppSpacing.s1,
        vertical: _isPill ? AppSpacing.s1 : AppSpacing.s0,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (_isPill && selected) ...<Widget>[
            Text(
              selectedGlyph,
              style: AppTypography.label.copyWith(color: colors.foreground),
            ),
            const SizedBox(width: AppSpacing.s0),
          ],
          Text(
            label,
            style: AppTypography.label.copyWith(color: colors.foreground),
          ),
          if (onRemove != null) ...<Widget>[
            const SizedBox(width: AppSpacing.s0),
            _RemoveButton(
              semanticLabel: removeSemanticLabel!,
              color: colors.foreground,
              onPressed: onRemove!,
            ),
          ],
        ],
      ),
    );

    if (onTap == null) {
      return Semantics(selected: _isPill ? selected : null, child: body);
    }

    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: ExcludeSemantics(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: AppSizing.minTouchTargetHeight,
            minWidth: AppSizing.minTouchTargetWidth,
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onTap,
              borderRadius: _isPill ? AppRadius.borderFull : AppRadius.borderXs,
              child: Center(widthFactor: 1, child: body),
            ),
          ),
        ),
      ),
    );
  }
}

/// The `×` affordance on a removable chip.
class _RemoveButton extends StatelessWidget {
  const _RemoveButton({
    required this.semanticLabel,
    required this.color,
    required this.onPressed,
  });

  final String semanticLabel;
  final Color color;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: semanticLabel,
    child: ExcludeSemantics(
      child: SizedBox(
        width: AppSizing.minTouchTargetWidth,
        height: AppSizing.minTouchTargetHeight,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onPressed,
            borderRadius: AppRadius.borderFull,
            child: Center(
              child: Text(
                PChip.removeGlyph,
                style: AppTypography.label.copyWith(color: color),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

@immutable
class _PChipColors {
  const _PChipColors({
    required this.background,
    required this.foreground,
    this.border,
  });

  final Color background;
  final Color foreground;
  final Color? border;
}

_PChipColors _colorsFor(PChipVariant variant, PChipTone tone, bool selected) {
  if (variant == PChipVariant.filter) {
    return selected
        ? const _PChipColors(
            background: AppColors.ink,
            foreground: AppColors.paper,
          )
        : const _PChipColors(
            background: Colors.transparent,
            foreground: AppColors.ink,
            border: AppColors.inkMid,
          );
  }

  switch (tone) {
    case PChipTone.neutral:
      return const _PChipColors(
        background: AppColors.paper2,
        foreground: AppColors.inkSoft,
      );
    case PChipTone.veg:
      return const _PChipColors(
        background: AppColors.cardamomSoft,
        foreground: AppColors.cardamomSoftForeground,
      );
    case PChipTone.warm:
      return const _PChipColors(
        background: AppColors.haldiSoft,
        foreground: AppColors.ink,
      );
    case PChipTone.accent:
      return const _PChipColors(
        background: AppColors.terracotta,
        foreground: AppColors.paper,
      );
  }
}
