import 'package:flutter/material.dart';

import '../tokens.dart';
import 'p_back_chevron.dart';

/// The screen header from the design source's *Mobile app shell*.
///
/// Anatomy: one row with the optional back affordance at the left edge, the
/// screen title **centred** in Instrument Serif at `display-m` (the wireframe's
/// centred title, scaled), and an optional [trailing] action at the right
/// edge; then an optional centred meta [subtitle] beneath.
///
/// The title is centred on the bar, not on the space left between the slots.
/// It is inset by [_sideInset] on each side — the width of one 44pt control
/// plus a gap — so a single back or trailing control never touches it. A very
/// long title wraps within that inset.
///
/// This is a plain widget, not a [PreferredSizeWidget] — its height depends on
/// whether a subtitle is present and on the user's text scale, so it is meant
/// to be placed at the top of a scroll view or column, not handed to
/// `Scaffold.appBar`.
class PTopBar extends StatelessWidget {
  const PTopBar({
    super.key,
    required this.title,
    this.subtitle,
    this.onBack,
    this.backSemanticLabel,
    this.backGlyph,
    this.trailing,
  }) : assert(
         onBack == null || backSemanticLabel != null,
         'A back control needs a screen-reader label — the glyph is not one.',
       );

  /// The design source's typographic `‹`. No longer the default (the bold
  /// drawn chevron is); kept for callers that want the text glyph explicitly.
  static const String defaultBackGlyph = '‹';

  /// Screen title, in the display serif.
  final String title;

  /// Optional meta line, e.g. "42 items · updated 2m ago".
  final String? subtitle;

  /// Non-null renders the back affordance.
  final VoidCallback? onBack;

  /// Required whenever [onBack] is given.
  final String? backSemanticLabel;

  /// Override the back glyph with a text glyph. Null (the default) draws the
  /// bold [PBackChevron].
  final String? backGlyph;

  /// Optional trailing action, usually a [PIconButton].
  final Widget? trailing;

  /// Space reserved either side of the title for one 44pt control and a gap.
  static const double _sideInset = AppSizing.minTouchTargetWidth + AppSpacing.s1;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppSpacing.s3,
      AppSpacing.s2,
      AppSpacing.s3,
      AppSpacing.s3,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: AppSizing.minTouchTargetHeight,
          ),
          child: Stack(
            alignment: Alignment.center,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: _sideInset),
                child: Semantics(
                  header: true,
                  child: Text(
                    title,
                    textAlign: TextAlign.center,
                    style: AppTypography.displayM.copyWith(
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ),
              if (onBack != null)
                Positioned.fill(
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: PTopBarBackButton(
                      glyph: backGlyph,
                      semanticLabel: backSemanticLabel!,
                      onPressed: onBack,
                    ),
                  ),
                ),
              if (trailing != null)
                Positioned.fill(
                  child: Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: trailing,
                  ),
                ),
            ],
          ),
        ),
        if (subtitle != null) ...<Widget>[
          const SizedBox(height: AppSpacing.s0),
          Text(
            subtitle!,
            textAlign: TextAlign.center,
            style: AppTypography.label.copyWith(color: AppColors.inkMid),
          ),
        ],
      ],
    ),
  );
}

/// The top bar's back affordance.
///
/// Draws a bold 24px [PBackChevron] by default, in a 44pt target with an ink
/// response. A non-default [glyph] is rendered as text (backward compatible
/// with [PTopBar.backGlyph]). Also used outside [PTopBar] (e.g. over the camera
/// preview) so every back affordance in the app looks and behaves the same.
class PTopBarBackButton extends StatelessWidget {
  const PTopBarBackButton({
    super.key,
    this.glyph,
    required this.semanticLabel,
    required this.onPressed,
    this.color = AppColors.ink,
    this.shape,
  });

  /// Text glyph override; null draws the bold [PBackChevron].
  final String? glyph;
  final String semanticLabel;
  final VoidCallback? onPressed;

  /// Glyph colour; defaults to [AppColors.ink].
  final Color color;

  /// Optional ink-splash shape, e.g. a circle when over imagery.
  final ShapeBorder? shape;

  @override
  Widget build(BuildContext context) {
    final String? textGlyph = glyph;
    return Semantics(
      button: true,
      label: semanticLabel,
      onTap: onPressed,
      excludeSemantics: true,
      child: SizedBox(
        width: AppSizing.minTouchTargetWidth,
        height: AppSizing.minTouchTargetHeight,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onPressed,
            borderRadius: shape == null ? AppRadius.borderM : null,
            customBorder: shape,
            child: Center(
              child: textGlyph == null
                  ? PBackChevron(color: color)
                  : Text(
                      textGlyph,
                      style: AppTypography.title.copyWith(color: color),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
