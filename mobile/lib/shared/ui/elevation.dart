import 'package:flutter/painting.dart';

import 'colors.dart';

/// Elevation tokens, ported from `shared/design-tokens.json` -> `elevation`.
///
/// No coloured shadows — every shadow is [AppColors.ink] at low opacity.
abstract final class AppElevation {
  /// Level 0, "flat" — list rows and cards.
  ///
  /// The JSON specifies `"shadow": "border only"`, so there is deliberately no
  /// shadow here. A surface at e0 must be given a **border** (typically a
  /// hairline in [AppColors.paper2]) by the component that uses it; an empty
  /// shadow list alone will render as an undifferentiated flat block.
  static const List<BoxShadow> e0 = <BoxShadow>[];

  /// Level 1, "resting" — bottom sheets, popovers.
  static const List<BoxShadow> e1 = <BoxShadow>[
    BoxShadow(
      color: Color(0x0A1F1A15), // ink @ 0.04
      offset: Offset(0, 1),
      blurRadius: 2,
    ),
    BoxShadow(
      color: Color(0x0F1F1A15), // ink @ 0.06
      offset: Offset(0, 4),
      blurRadius: 12,
    ),
  ];

  /// Level 2, "lifted" — modals, dragged items.
  static const List<BoxShadow> e2 = <BoxShadow>[
    BoxShadow(
      color: Color(0x0F1F1A15), // ink @ 0.06
      offset: Offset(0, 2),
      blurRadius: 4,
    ),
    BoxShadow(
      color: Color(0x1F1F1A15), // ink @ 0.12
      offset: Offset(0, 12),
      blurRadius: 32,
    ),
  ];
}
