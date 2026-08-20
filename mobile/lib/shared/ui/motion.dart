import 'package:flutter/animation.dart';

/// Motion tokens, ported from `shared/design-tokens.json` -> `motion`.
///
/// House rules that these tokens exist to enforce (JSON `motion.rules`):
/// no parallax; no page transitions that block interaction; nothing longer
/// than 400ms on a primary interaction; no spring bounces on repeatable
/// actions (e.g. ticking off a list); honour OS reduce-motion by degrading
/// signature animations to cross-fades.
abstract final class AppMotion {
  static const Duration instant = Duration(milliseconds: 80);
  static const Duration quick = Duration(milliseconds: 160);
  static const Duration standard = Duration(milliseconds: 240);
  static const Duration gentle = Duration(milliseconds: 360);

  /// `cubic-bezier(0.2, 0, 0, 1)` — the default for entrances and moves.
  static const Cubic easeStandard = Cubic(0.2, 0, 0, 1);

  /// `cubic-bezier(0.3, 0, 0, 1)` — for the one thing you want noticed.
  static const Cubic easeEmphasized = Cubic(0.3, 0, 0, 1);

  /// `cubic-bezier(0.4, 0, 1, 1)` — accelerate away, for exits/dismissals.
  static const Cubic easeExit = Cubic(0.4, 0, 1, 1);
}
