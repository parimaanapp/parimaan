import 'package:flutter/painting.dart';

/// Corner-radius tokens, ported from `shared/design-tokens.json` -> `radius`.
///
/// CSS names (`r-xs` … `r-full`) become lowerCamelCase members here.
abstract final class AppRadius {
  /// Chips, small tags.
  static const double xs = 4;

  /// Small buttons, meta inputs.
  static const double s = 8;

  /// Buttons, inputs.
  static const double m = 12;

  /// Cards, sheets.
  static const double l = 16;

  /// Modals.
  static const double xl = 20;

  /// Pills, avatars. CSS uses an arbitrarily large radius to get a pill; Dart
  /// has no "clamp to half the shorter side" primitive either, so the same
  /// oversized value is used and [borderFull] relies on Flutter clamping it.
  static const double full = 999;

  // `BorderRadius.circular(x)` is a non-const factory; `BorderRadius.all(
  // Radius.circular(x))` is the const-constructible equivalent, and using it
  // here lets every consumer of these (e.g. `theme.dart`'s button shapes)
  // stay `const` too instead of forcing runtime allocation transitively.
  static const BorderRadius borderXs = BorderRadius.all(Radius.circular(xs));
  static const BorderRadius borderS = BorderRadius.all(Radius.circular(s));
  static const BorderRadius borderM = BorderRadius.all(Radius.circular(m));
  static const BorderRadius borderL = BorderRadius.all(Radius.circular(l));
  static const BorderRadius borderXl = BorderRadius.all(Radius.circular(xl));

  /// Pill / circle. Flutter clamps an over-large radius to the shape's bounds.
  static const BorderRadius borderFull = BorderRadius.all(
    Radius.circular(full),
  );
}
