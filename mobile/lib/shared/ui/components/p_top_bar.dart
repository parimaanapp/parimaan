import 'package:flutter/material.dart';

import '../tokens.dart';
import 'p_back_chevron.dart';
import 'p_top_bar_layout.dart';

/// The screen header from the design source's *Mobile app shell*.
///
/// Anatomy: one row with the optional back affordance at the left edge, the
/// screen title **centred** in Instrument Serif at `display-m` (the wireframe's
/// centred title, scaled), and an optional [trailing] action at the right
/// edge; then an optional centred meta [subtitle] beneath.
///
/// The title is centred on the bar with the wider of the leading and trailing
/// controls (plus a gap) reserved on both sides, wraps within what remains, and
/// never overlaps a control. When fewer than 120 px would remain it falls back
/// to a start-aligned title between the two controls. See [PTopBarLayout].
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

  /// Below this width the centred title falls back to start alignment.
  static const double _minTitleWidth = 120;

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
        PTopBarLayout(
          gap: AppSpacing.s1,
          minTitleWidth: _minTitleWidth,
          minHeight: AppSizing.minTouchTargetHeight,
          leading: onBack == null
              ? const SizedBox.shrink()
              : PTopBarBackButton(
                  glyph: backGlyph,
                  semanticLabel: backSemanticLabel!,
                  onPressed: onBack,
                ),
          title: Semantics(
            header: true,
            child: Text(
              title,
              textAlign: TextAlign.center,
              style: AppTypography.displayM.copyWith(color: AppColors.ink),
            ),
          ),
          trailing: trailing ?? const SizedBox.shrink(),
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
