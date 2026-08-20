import 'package:flutter/material.dart';

import 'tokens.dart';

/// The single Parimaan [ThemeData].
///
/// Light only — the MVP has no dark mode, and none of the locked docs call for
/// one. Every value here comes from `tokens.dart` / `typography.dart`, which
/// are in turn verbatim ports of `shared/design-tokens.json`.
ThemeData parimaanTheme() {
  final ThemeData base = ThemeData(
    useMaterial3: true,
    colorScheme: _colorScheme,
    scaffoldBackgroundColor: AppColors.paper,
    canvasColor: AppColors.paper2,
    splashFactory: InkSparkle.splashFactory,
  );

  // `copyWith` rather than the ThemeData constructor: the constructor runs the
  // supplied text theme through `Typography` merging + colour application,
  // which would silently rewrite the ported scale.
  return base.copyWith(
    textTheme: _textTheme,
    primaryTextTheme: _textTheme,
    elevatedButtonTheme: ElevatedButtonThemeData(style: _primaryButtonStyle),
    outlinedButtonTheme: OutlinedButtonThemeData(style: _secondaryButtonStyle),
    textButtonTheme: TextButtonThemeData(style: _ghostButtonStyle),
  );
}

const ColorScheme _colorScheme = ColorScheme(
  brightness: Brightness.light,
  primary: AppColors.terracotta,
  onPrimary: AppColors.paper,
  primaryContainer: AppColors.haldiSoft,
  onPrimaryContainer: AppColors.ink,
  secondary: AppColors.cardamom,
  onSecondary: AppColors.paper,
  secondaryContainer: AppColors.cardamomSoft,
  onSecondaryContainer: AppColors.cardamomSoftForeground,
  tertiary: AppColors.haldi,
  onTertiary: AppColors.ink,
  error: AppColors.danger,
  onError: AppColors.paper,
  surface: AppColors.card,
  onSurface: AppColors.ink,
  surfaceContainerLowest: AppColors.card,
  surfaceContainerLow: AppColors.paper,
  surfaceContainer: AppColors.paper2,
  onSurfaceVariant: AppColors.inkSoft,
  outline: AppColors.inkMid,
  outlineVariant: AppColors.paper2,
  shadow: AppColors.ink,
  scrim: AppColors.ink,
  inverseSurface: AppColors.ink,
  onInverseSurface: AppColors.paper,
  inversePrimary: AppColors.haldi,
);

/// Material's text-theme slots mapped onto the design system's scale.
///
/// The mapping is deliberately narrow: `display*` are the three Instrument
/// Serif hero sizes, `titleLarge` is the section title, the `body*` slots are
/// DM Sans, and `labelSmall` is the tracked all-caps meta style (remember to
/// `.toUpperCase()` the string yourself — [TextStyle] cannot transform case).
/// [AppTypography.mono] has no Material slot; use it directly.
final TextTheme _textTheme = TextTheme(
  displayLarge: AppTypography.displayXl.copyWith(color: AppColors.ink),
  displayMedium: AppTypography.displayL.copyWith(color: AppColors.ink),
  displaySmall: AppTypography.displayM.copyWith(color: AppColors.ink),
  headlineMedium: AppTypography.displayM.copyWith(color: AppColors.ink),
  headlineSmall: AppTypography.title.copyWith(color: AppColors.ink),
  titleLarge: AppTypography.title.copyWith(color: AppColors.ink),
  titleMedium: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
  titleSmall: AppTypography.label.copyWith(color: AppColors.ink),
  bodyLarge: AppTypography.bodyLg.copyWith(color: AppColors.ink),
  bodyMedium: AppTypography.body.copyWith(color: AppColors.ink),
  bodySmall: AppTypography.label.copyWith(color: AppColors.inkSoft),
  labelLarge: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
  labelMedium: AppTypography.label.copyWith(color: AppColors.inkSoft),
  // Meta labels use inkMid as their minimum ink (accessibility rule 3).
  labelSmall: AppTypography.meta.copyWith(color: AppColors.inkMid),
);

/// Shared geometry for all three button variants.
const ButtonStyle _buttonBase = ButtonStyle(
  minimumSize: WidgetStatePropertyAll<Size>(
    Size(AppSizing.minTouchTargetWidth, AppSizing.buttonMinHeight),
  ),
  padding: WidgetStatePropertyAll<EdgeInsetsGeometry>(
    EdgeInsets.symmetric(
      horizontal: AppSpacing.s4,
      vertical: AppSpacing.s2,
    ),
  ),
  shape: WidgetStatePropertyAll<OutlinedBorder>(
    RoundedRectangleBorder(borderRadius: AppRadius.borderM),
  ),
  textStyle: WidgetStatePropertyAll<TextStyle>(AppTypography.bodyStrong),
  // "No colored shadows" — buttons sit flat (e0) on their surface.
  elevation: WidgetStatePropertyAll<double>(0),
  animationDuration: AppMotion.quick,
);

/// Primary — filled terracotta. **One primary per screen**
/// (`componentRules.buttons.rule`); nothing in [ThemeData] can enforce that,
/// so it is a review-time rule.
final ButtonStyle _primaryButtonStyle = _buttonBase.copyWith(
  backgroundColor: const WidgetStateProperty<Color>.fromMap(
    <WidgetStatesConstraint, Color>{
      WidgetState.pressed: AppColors.terracottaDeep,
      WidgetState.any: AppColors.terracotta,
    },
  ),
  foregroundColor: const WidgetStatePropertyAll<Color>(AppColors.paper),
);

/// Secondary — outlined, ink label on the page surface.
final ButtonStyle _secondaryButtonStyle = _buttonBase.copyWith(
  backgroundColor: const WidgetStatePropertyAll<Color>(Color(0x00000000)),
  foregroundColor: const WidgetStateProperty<Color>.fromMap(
    <WidgetStatesConstraint, Color>{
      WidgetState.pressed: AppColors.terracottaDeep,
      WidgetState.any: AppColors.ink,
    },
  ),
  side: const WidgetStatePropertyAll<BorderSide>(
    // Default hairline width; the token set defines no border thickness.
    BorderSide(color: AppColors.inkMid),
  ),
);

/// Ghost — label only, for tertiary actions and links.
final ButtonStyle _ghostButtonStyle = _buttonBase.copyWith(
  backgroundColor: const WidgetStatePropertyAll<Color>(Color(0x00000000)),
  foregroundColor: const WidgetStateProperty<Color>.fromMap(
    <WidgetStatesConstraint, Color>{
      WidgetState.pressed: AppColors.terracottaDeep,
      WidgetState.any: AppColors.terracotta,
    },
  ),
);

// ---------------------------------------------------------------------------
// What this theme deliberately does NOT encode
// ---------------------------------------------------------------------------
// `componentRules.buttons` lists five variants — primary, secondary, ghost,
// affirmative, destructive — but Flutter's built-in button theming only has
// three button widgets to hang styles off. The remaining rules land on the
// shared `PButton` component (a later slice), which will own:
//
//   * affirmative — cardamom fill, reserved for "Have it / Bought / Made",
//     i.e. actions that move the core loop forward. Never a generic "save".
//   * destructive — danger-coloured but **always outlined, never filled**.
//   * the "one primary per screen" rule, enforced by review, not by code.
//   * the focus ring (AppSizing.focusRingWidth haldi outline +
//     AppSizing.focusRingSpacer paper spacer) — never the OS default outline.
//   * pairing every colour state with an icon or text, since colour alone is
//     not allowed to carry meaning.
