import 'package:flutter/material.dart';

import '../tokens.dart';
import 'p_back_chevron.dart';

/// The screen header from the design source's *Mobile app shell*.
///
/// Anatomy, top to bottom: a control row (optional back affordance on the
/// left, optional [trailing] action on the right), then the screen title in
/// Instrument Serif at `display-m`, then an optional meta [subtitle].
///
/// **Note on the title's alignment.** The title is left-aligned, not centred:
/// that is what the design source draws (a large serif title sitting under the
/// control row, not a centred iOS-style navigation title). Anything centred
/// here would fight the 28pt type at narrow widths.
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

  bool get _hasControlRow => onBack != null || trailing != null;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppSpacing.s3,
      AppSpacing.s2,
      AppSpacing.s3,
      AppSpacing.s3,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (_hasControlRow)
          Row(
            children: <Widget>[
              if (onBack != null)
                PTopBarBackButton(
                  glyph: backGlyph,
                  semanticLabel: backSemanticLabel!,
                  onPressed: onBack,
                ),
              const Spacer(),
              ?trailing,
            ],
          ),
        const SizedBox(height: AppSpacing.s1),
        Semantics(
          header: true,
          child: Text(
            title,
            style: AppTypography.displayM.copyWith(color: AppColors.ink),
          ),
        ),
        if (subtitle != null) ...<Widget>[
          const SizedBox(height: AppSpacing.s0),
          Text(
            subtitle!,
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
