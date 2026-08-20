import 'package:flutter/material.dart';

import '../tokens.dart';

/// The three elevation levels a card can sit at.
///
/// [e0] is the default and the one the design source actually uses for cards
/// and list rows: *"border only"*, no shadow. [e1] and [e2] exist so bottom
/// sheets, popovers and modals can reuse the same surface without redefining
/// it — at those levels the shadow does the separating, so the border is
/// dropped (a shadow plus a hairline reads as a double edge).
enum PCardElevation { e0, e1, e2 }

/// A raised Parimaan surface.
///
/// Optionally tappable. Per the accessibility rules, a tappable card is one
/// big tap target — do not nest links or buttons inside a tappable card; use
/// swipe actions or make the card itself the target.
class PCard extends StatelessWidget {
  const PCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.s3),
    this.elevation = PCardElevation.e0,
    this.onTap,
    this.semanticLabel,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final PCardElevation elevation;

  /// Non-null makes the whole card a single tap target.
  final VoidCallback? onTap;

  /// Optional screen-reader label for a tappable card whose contents do not
  /// read well as a sentence.
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final Widget surface = Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadius.borderL,
        boxShadow: _shadow,
        border: elevation == PCardElevation.e0
            // `elevation.dart` spells this out: e0 is "border only", and a
            // surface at e0 without a border renders as an undifferentiated
            // flat block.
            ? const Border.fromBorderSide(BorderSide(color: AppColors.paper2))
            : null,
      ),
      padding: padding,
      child: child,
    );

    if (onTap == null) return surface;

    return Semantics(
      button: true,
      label: semanticLabel,
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: AppSizing.minTouchTargetHeight,
          minWidth: AppSizing.minTouchTargetWidth,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: AppRadius.borderL,
            child: surface,
          ),
        ),
      ),
    );
  }

  List<BoxShadow> get _shadow {
    switch (elevation) {
      case PCardElevation.e0:
        return AppElevation.e0;
      case PCardElevation.e1:
        return AppElevation.e1;
      case PCardElevation.e2:
        return AppElevation.e2;
    }
  }
}
