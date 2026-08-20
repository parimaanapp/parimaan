import 'package:flutter/painting.dart';

/// Colour tokens, ported verbatim from `shared/design-tokens.json` -> `color`.
///
/// Direction A, "Haldi & Terracotta". Names here are exactly the names in the
/// JSON — never introduce a colour that does not have a name there, and never
/// hardcode a hex outside this file.
///
/// Drift between this file and the JSON is caught by
/// `test/shared/ui/tokens_test.dart`.
abstract final class AppColors {
  // ---- neutral --------------------------------------------------------
  /// App background.
  static const Color paper = Color(0xFFFBF6EE);

  /// Canvas / sections.
  static const Color paper2 = Color(0xFFF5EFE4);

  /// Raised surfaces.
  static const Color card = Color(0xFFFFFFFF);

  /// Secondary text.
  static const Color inkSoft = Color(0xFF5A4F42);

  /// Meta / hints. Minimum ink for meta labels — never for body copy.
  static const Color inkMid = Color(0xFF8B7C6B);

  /// Primary text.
  static const Color ink = Color(0xFF1F1A15);

  // ---- brand ----------------------------------------------------------
  /// Warm surface.
  static const Color haldiSoft = Color(0xFFF5DEA3);

  /// Accent, focus rings.
  static const Color haldi = Color(0xFFE8B961);

  /// Primary action.
  static const Color terracotta = Color(0xFFC25A2B);

  /// Pressed / links.
  static const Color terracottaDeep = Color(0xFFA64420);

  /// Affirmative ("Have it / Bought / Made").
  static const Color cardamom = Color(0xFF4F6B4A);

  /// Veg tag background.
  static const Color cardamomSoft = Color(0xFFDDE5D8);

  /// Foreground paired with [cardamomSoft].
  static const Color cardamomSoftForeground = Color(0xFF3A5236);

  // ---- semantic -------------------------------------------------------
  /// Have-it, bought.
  static const Color success = Color(0xFF4F6B4A);

  /// AI proposals, expiry.
  static const Color warning = Color(0xFFE8B961);

  /// Destructive, errors.
  static const Color danger = Color(0xFF9E2A2B);

  /// Activity, notices.
  static const Color info = Color(0xFF3A5A7C);
}
