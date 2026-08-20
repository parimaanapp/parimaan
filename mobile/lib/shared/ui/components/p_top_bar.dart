import 'package:flutter/material.dart';

import '../tokens.dart';

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
    this.backGlyph = defaultBackGlyph,
    this.trailing,
  }) : assert(
         onBack == null || backSemanticLabel != null,
         'A back control needs a screen-reader label — the glyph is not one.',
       );

  /// The `‹` the design source uses. A glyph, not translatable copy; the
  /// screen-reader announcement is [backSemanticLabel], which the caller owns.
  static const String defaultBackGlyph = '‹';

  /// Screen title, in the display serif.
  final String title;

  /// Optional meta line, e.g. "42 items · updated 2m ago".
  final String? subtitle;

  /// Non-null renders the back affordance.
  final VoidCallback? onBack;

  /// Required whenever [onBack] is given.
  final String? backSemanticLabel;

  /// Override the back glyph — e.g. a Phosphor code point once the icon set is
  /// mapped.
  final String backGlyph;

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
/// Public so screens (and tests) can refer to it by name, but only ever built
/// by [PTopBar]. It carries a *typographic* chevron rather than an [IconData]
/// because that is what the design source draws and because no Phosphor
/// code-point mapping exists in the repo yet — [PTopBar.backGlyph] is the seam
/// for swapping it once one does. The 44pt target, the ripple and the radius
/// still come from the same tokens every other control uses.
class PTopBarBackButton extends StatelessWidget {
  const PTopBarBackButton({
    super.key,
    required this.glyph,
    required this.semanticLabel,
    required this.onPressed,
  });

  final String glyph;
  final String semanticLabel;
  final VoidCallback? onPressed;

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
            borderRadius: AppRadius.borderM,
            child: Center(
              child: Text(
                glyph,
                style: AppTypography.title.copyWith(color: AppColors.ink),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
