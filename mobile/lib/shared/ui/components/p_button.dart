import 'package:flutter/material.dart';

import '../tokens.dart';

/// The five button variants from `design-tokens.json` ->
/// `componentRules.buttons.variants`.
///
/// `theme.dart` could only express three of these (Flutter ships exactly three
/// button widgets to hang a theme off); the remaining two, and the rules that
/// govern all five, live here — this is the "later slice" that file refers to.
enum PButtonVariant {
  /// Filled terracotta. **One primary per screen** — not enforceable in code,
  /// enforced at review time.
  primary,

  /// Outlined, ink label. The everyday secondary action.
  secondary,

  /// Label only. Tertiary actions and links.
  ghost,

  /// Filled cardamom. **Reserved for "Have it / Bought / Made"** — actions that
  /// move the core loop forward. Never a generic "Save".
  affirmative,

  /// Danger-coloured and **always outlined, never filled**, at every widget
  /// state. Destroying something should never look like the happy path.
  destructive,
}

/// Standard (44-high, comfortable) vs. compact (tighter padding, smaller type).
///
/// Both sizes keep the [AppSizing.buttonMinHeight] floor: the design source
/// draws the compact button at roughly 33pt, which is below the 44pt
/// accessibility minimum, so the floor wins and only the padding, radius and
/// type scale change.
enum PButtonSize { standard, small }

/// The Parimaan button.
///
/// Stateless and provider-free by contract: every piece of copy and every
/// callback arrives through the constructor, which is what lets the whole set
/// be golden-tested in isolation and reused from any feature.
///
/// Accessibility rules this component owns, from `design-tokens.json` ->
/// `accessibility`:
///
///  * **Touch target** — never smaller than
///    [AppSizing.minTouchTargetWidth] x [AppSizing.buttonMinHeight].
///  * **Focus ring** — [AppColors.haldi] at [AppSizing.focusRingWidth],
///    never the OS default outline.
///  * **Colour never carries meaning alone** — [label] is required for every
///    variant, so the destructive/affirmative reading survives colour blindness
///    and greyscale.
class PButton extends StatelessWidget {
  /// A labelled button, optionally with a leading [icon].
  const PButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = PButtonVariant.primary,
    this.size = PButtonSize.standard,
    this.icon,
    this.isLoading = false,
    this.loadingLabel,
    this.expand = false,
  }) : semanticLabel = null,
       _iconOnly = false;

  /// The icon-only 44x44 variant from the design source.
  ///
  /// [semanticLabel] is required, not optional: a glyph is not a label, and a
  /// screen reader has nothing else to announce. [PIconButton] is the
  /// friendlier public name for this and delegates straight here, so the
  /// styling has exactly one home.
  const PButton.icon({
    super.key,
    required IconData this.icon,
    required String this.semanticLabel,
    required this.onPressed,
    this.variant = PButtonVariant.secondary,
    this.isLoading = false,
  }) : label = '',
       size = PButtonSize.standard,
       loadingLabel = null,
       expand = false,
       _iconOnly = true;

  /// Visible button copy. Supplied by the caller — see the i18n note in
  /// `components.dart`.
  final String label;

  /// `null` disables the button.
  final VoidCallback? onPressed;

  final PButtonVariant variant;
  final PButtonSize size;

  /// Leading icon, or the only content for [PButton.icon]. Callers pass the
  /// glyph so this library never depends on one icon set.
  final IconData? icon;

  /// Swaps the content for a spinner and makes the button inert.
  final bool isLoading;

  /// Optional copy shown instead of [label] while [isLoading] — e.g.
  /// "Planning…" in place of "Plan the week".
  final String? loadingLabel;

  /// Stretch to the width of the parent instead of hugging the label.
  final bool expand;

  /// Screen-reader label for [PButton.icon].
  final String? semanticLabel;

  final bool _iconOnly;

  bool get _isEnabled => onPressed != null && !isLoading;

  @override
  Widget build(BuildContext context) {
    final Widget button = TextButton(
      onPressed: _isEnabled ? onPressed : null,
      style: pButtonStyle(variant: variant, size: size, iconOnly: _iconOnly),
      child: _content(),
    );

    if (_iconOnly) {
      return Semantics(
        button: true,
        label: semanticLabel,
        enabled: _isEnabled,
        child: ExcludeSemantics(child: button),
      );
    }
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }

  Widget _content() {
    if (_iconOnly) {
      return isLoading
          ? const _PButtonSpinner()
          : Icon(icon, size: AppSizing.icon20);
    }

    final String text = isLoading ? (loadingLabel ?? label) : label;
    final List<Widget> children = <Widget>[
      if (isLoading)
        const _PButtonSpinner()
      else if (icon != null)
        Icon(icon, size: AppSizing.icon20),
      if (isLoading || icon != null) const SizedBox(width: AppSpacing.s1),
      Flexible(child: Text(text, textAlign: TextAlign.center)),
    ];

    return Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: children,
    );
  }
}

/// The spinner shown in the loading state.
///
/// Sized to [AppSizing.icon16] so it sits on the text baseline like an inline
/// icon; it inherits the button's foreground colour from [IconTheme]-adjacent
/// [DefaultTextStyle], set by the resolved [ButtonStyle].
class _PButtonSpinner extends StatelessWidget {
  const _PButtonSpinner();

  @override
  Widget build(BuildContext context) => SizedBox(
    width: AppSizing.icon16,
    height: AppSizing.icon16,
    child: CircularProgressIndicator(
      // The design source draws a 2px ring; the token set has no stroke-width
      // token, so the framework default is used rather than inventing one.
      color: DefaultTextStyle.of(context).style.color,
    ),
  );
}

/// Builds the [ButtonStyle] for a variant/size pair.
///
/// Public because [PIconButton] and any future button-shaped control (a FAB,
/// a segmented control) must resolve to the same tokens rather than
/// re-deriving them.
ButtonStyle pButtonStyle({
  required PButtonVariant variant,
  PButtonSize size = PButtonSize.standard,
  bool iconOnly = false,
}) {
  final bool filled =
      variant == PButtonVariant.primary ||
      variant == PButtonVariant.affirmative;

  return ButtonStyle(
    backgroundColor: WidgetStateProperty.resolveWith<Color>(
      (Set<WidgetState> states) => _background(variant, states),
    ),
    foregroundColor: WidgetStateProperty.resolveWith<Color>(
      (Set<WidgetState> states) => _foreground(variant, states),
    ),
    overlayColor: WidgetStatePropertyAll<Color>(
      filled ? Colors.transparent : AppColors.paper2,
    ),
    side: WidgetStateProperty.resolveWith<BorderSide?>(
      (Set<WidgetState> states) => _side(variant, states),
    ),
    shape: WidgetStatePropertyAll<OutlinedBorder>(
      RoundedRectangleBorder(
        borderRadius: size == PButtonSize.small
            ? AppRadius.borderS
            : AppRadius.borderM,
      ),
    ),
    padding: WidgetStatePropertyAll<EdgeInsetsGeometry>(
      iconOnly
          ? EdgeInsets.zero
          : EdgeInsets.symmetric(
              horizontal: size == PButtonSize.small
                  ? AppSpacing.s2
                  : AppSpacing.s4,
              vertical: size == PButtonSize.small
                  ? AppSpacing.s1
                  : AppSpacing.s2,
            ),
    ),
    textStyle: WidgetStatePropertyAll<TextStyle>(
      size == PButtonSize.small
          ? AppTypography.label
          : AppTypography.bodyStrong,
    ),
    minimumSize: const WidgetStatePropertyAll<Size>(
      Size(AppSizing.minTouchTargetWidth, AppSizing.buttonMinHeight),
    ),
    fixedSize: iconOnly
        ? const WidgetStatePropertyAll<Size>(
            Size(AppSizing.minTouchTargetWidth, AppSizing.minTouchTargetHeight),
          )
        : null,
    // The min-size property above already guarantees the 44pt target, so the
    // framework's extra invisible padding would only inflate layout.
    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    // "No colored shadows" — buttons sit flat on their surface.
    elevation: const WidgetStatePropertyAll<double>(0),
    animationDuration: AppMotion.quick,
  );
}

// The design source's disabled primary/affirmative fill is a translucent
// ink wash (`rgba(31,26,21,0.12)`) over whatever surface sits behind the
// button, not an opaque named surface — the token set has no disabled-state
// alpha token, so this blends the wash directly off AppColors.ink rather
// than substituting an unrelated opaque token (e.g. paper2), which would be
// visually flatter than the source intends.
final Color _disabledFill = AppColors.ink.withValues(alpha: 0.12);

Color _background(PButtonVariant variant, Set<WidgetState> states) {
  switch (variant) {
    case PButtonVariant.secondary:
    case PButtonVariant.ghost:
    // Outlined at every single state — this is the rule the design system
    // states twice, so it is expressed as an unconditional return.
    case PButtonVariant.destructive:
      return Colors.transparent;
    case PButtonVariant.primary:
      if (states.contains(WidgetState.disabled)) return _disabledFill;
      if (states.contains(WidgetState.pressed)) return AppColors.terracottaDeep;
      return AppColors.terracotta;
    case PButtonVariant.affirmative:
      if (states.contains(WidgetState.disabled)) return _disabledFill;
      return AppColors.cardamom;
  }
}

Color _foreground(PButtonVariant variant, Set<WidgetState> states) {
  if (states.contains(WidgetState.disabled)) return AppColors.inkMid;
  switch (variant) {
    case PButtonVariant.primary:
    case PButtonVariant.affirmative:
      return AppColors.paper;
    case PButtonVariant.secondary:
      return AppColors.ink;
    case PButtonVariant.ghost:
      return AppColors.terracottaDeep;
    case PButtonVariant.destructive:
      return AppColors.danger;
  }
}

BorderSide? _side(PButtonVariant variant, Set<WidgetState> states) {
  // The focus ring replaces whatever border the variant normally draws.
  // Flutter's ButtonStyle has no "ring outside the bounds" primitive, so the
  // 2pt paper spacer of `accessibility.focusRing` is expressed by the button's
  // own padding rather than by a second, outer stroke.
  if (states.contains(WidgetState.focused)) {
    return const BorderSide(
      color: AppColors.haldi,
      width: AppSizing.focusRingWidth,
    );
  }
  switch (variant) {
    case PButtonVariant.primary:
    case PButtonVariant.affirmative:
    case PButtonVariant.ghost:
      return null;
    case PButtonVariant.secondary:
      // Hairline at the framework default width; the token set defines no
      // border-thickness token (same call `theme.dart` made).
      return const BorderSide(color: AppColors.inkMid);
    case PButtonVariant.destructive:
      return const BorderSide(color: AppColors.danger);
  }
}
