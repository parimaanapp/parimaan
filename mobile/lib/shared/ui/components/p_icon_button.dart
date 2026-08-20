import 'package:flutter/material.dart';

import 'p_button.dart';

/// The icon-only 44x44 control from the design source.
///
/// **Engineering call: composition, not duplication.** The design system draws
/// the icon-only button inside the *Buttons* block, as one more cell in the
/// same grid — it is a button whose content happens to be a glyph, not a
/// separate primitive. So [PIconButton] holds no styling of its own and
/// delegates to [PButton.icon]; the tokens resolve in exactly one place
/// (`pButtonStyle`), and a change to, say, the focus ring cannot drift between
/// the two. It exists as its own named widget only because the Phase 1 exit
/// criteria list "IconButton" as a component in its own right and because
/// `PIconButton(icon: …)` is what a caller reaches for.
///
/// [semanticLabel] is required. A glyph is not a label, and this control has no
/// visible text for a screen reader to fall back on.
class PIconButton extends StatelessWidget {
  const PIconButton({
    super.key,
    required this.icon,
    required this.semanticLabel,
    required this.onPressed,
    this.variant = PButtonVariant.secondary,
    this.isLoading = false,
  });

  /// The glyph. Passed in by the caller so this library never hard-codes a
  /// dependency on one icon set.
  final IconData icon;

  /// Announced by screen readers in place of the glyph.
  final String semanticLabel;

  /// `null` disables the control.
  final VoidCallback? onPressed;

  final PButtonVariant variant;

  /// Swaps the glyph for a spinner and makes the control inert.
  final bool isLoading;

  @override
  Widget build(BuildContext context) => PButton.icon(
    icon: icon,
    semanticLabel: semanticLabel,
    onPressed: onPressed,
    variant: variant,
    isLoading: isLoading,
  );
}
