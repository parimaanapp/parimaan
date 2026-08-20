/// Spacing tokens, ported from `shared/design-tokens.json` -> `spacing`.
///
/// Only these values — no in-betweens. If a layout seems to need 20px, it
/// needs [s3] or [s4], not a new token.
abstract final class AppSpacing {
  /// The scale is a multiple of this unit.
  static const double baseUnit = 4;

  static const double s0 = 4;
  static const double s1 = 8;
  static const double s2 = 12;
  static const double s3 = 16;
  static const double s4 = 24;
  static const double s5 = 32;
  static const double s6 = 48;
  static const double s7 = 64;
}
