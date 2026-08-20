/// Size tokens, ported from `shared/design-tokens.json` -> `accessibility`,
/// `iconography` and `componentRules`.
abstract final class AppSizing {
  /// `accessibility.minTouchTarget` — 44x44 pt, non-negotiable floor for any
  /// interactive element.
  static const double minTouchTargetWidth = 44;
  static const double minTouchTargetHeight = 44;

  /// `accessibility.focusRing`: 3px haldi outline + 2px paper spacer.
  /// Never the browser/OS default outline.
  static const double focusRingWidth = 3;
  static const double focusRingSpacer = 2;

  /// `componentRules.buttons.minHeight`.
  static const double buttonMinHeight = 44;

  // ---- iconography.sizes (Phosphor Icons, Regular / 1.5px stroke) ------
  /// Inline with text.
  static const double icon16 = 16;

  /// UI default.
  static const double icon20 = 20;

  /// Navigation.
  static const double icon24 = 24;

  /// Empty states.
  static const double icon32 = 32;

  /// The full icon ramp, in the JSON's order.
  static const List<double> iconSizes = <double>[icon16, icon20, icon24, icon32];
}
