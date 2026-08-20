import 'package:flutter/painting.dart';

/// Font families, from `shared/design-tokens.json` -> `typography.families`.
///
/// These strings must match the `family:` keys declared in `pubspec.yaml`.
abstract final class AppFontFamily {
  /// Titles and hero copy. Has an italic cut used sparingly for warmth
  /// (greetings, section intros).
  static const String display = 'Instrument Serif';

  /// Everything that is not a title.
  static const String ui = 'DM Sans';

  /// Used ONLY for the wordmark "परिमाण" and once on the About screen.
  /// Never for UI copy.
  static const String wordmark = 'Noto Serif Devanagari';

  /// Invite codes, dense quantities, timestamps. Never body copy.
  static const String mono = 'JetBrains Mono';
}

/// Type scale, ported from `shared/design-tokens.json` -> `typography.scale`.
///
/// Two conversions happen here, both deliberate:
///
/// * **height** — the JSON gives an absolute `lineHeight` in px, but Flutter's
///   [TextStyle.height] is a *multiplier* of `fontSize`. Every style below
///   therefore stores `lineHeight / size`.
/// * **letterSpacing** — the JSON gives an em-relative value (CSS `tracking`),
///   while Flutter's [TextStyle.letterSpacing] is in logical pixels. The
///   value is multiplied by `fontSize`.
///
/// House rules worth remembering while using these: serif for titles, sans
/// everywhere else; never mix serif and sans inside one phrase; never all-caps
/// except [meta].
abstract final class AppTypography {
  /// Onboarding hero. 56/60 Instrument Serif 400.
  static const TextStyle displayXl = TextStyle(
    fontFamily: AppFontFamily.display,
    fontSize: 56,
    height: 60 / 56,
    fontWeight: FontWeight.w400,
  );

  /// Screen hero. 40/44 Instrument Serif 400.
  static const TextStyle displayL = TextStyle(
    fontFamily: AppFontFamily.display,
    fontSize: 40,
    height: 44 / 40,
    fontWeight: FontWeight.w400,
  );

  /// Screen title. 28/32 Instrument Serif 400.
  static const TextStyle displayM = TextStyle(
    fontFamily: AppFontFamily.display,
    fontSize: 28,
    height: 32 / 28,
    fontWeight: FontWeight.w400,
  );

  /// Section title. 20/26 Instrument Serif 400.
  static const TextStyle title = TextStyle(
    fontFamily: AppFontFamily.display,
    fontSize: 20,
    height: 26 / 20,
    fontWeight: FontWeight.w400,
  );

  /// Long-form body. 16/24 DM Sans 400.
  static const TextStyle bodyLg = TextStyle(
    fontFamily: AppFontFamily.ui,
    fontSize: 16,
    height: 24 / 16,
    fontWeight: FontWeight.w400,
  );

  /// Default body. 15/22 DM Sans 400.
  static const TextStyle body = TextStyle(
    fontFamily: AppFontFamily.ui,
    fontSize: 15,
    height: 22 / 15,
    fontWeight: FontWeight.w400,
  );

  /// Emphasis within body copy. 15/22 DM Sans 600.
  static const TextStyle bodyStrong = TextStyle(
    fontFamily: AppFontFamily.ui,
    fontSize: 15,
    height: 22 / 15,
    fontWeight: FontWeight.w600,
  );

  /// Field labels, chips. 13/18 DM Sans 500.
  static const TextStyle label = TextStyle(
    fontFamily: AppFontFamily.ui,
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w500,
  );

  /// Tiny all-caps meta labels. 11/14 DM Sans 600, tracked 0.14em.
  ///
  /// The JSON declares `"transform": "uppercase"`, which [TextStyle] cannot
  /// express — Flutter has no text-transform. **Uppercasing is the caller's
  /// responsibility**: pass `myLabel.toUpperCase()` to the `Text` widget.
  static const TextStyle meta = TextStyle(
    fontFamily: AppFontFamily.ui,
    fontSize: 11,
    height: 14 / 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.14 * 11, // 0.14em at 11px
  );

  /// Invite codes, quantities, timestamps. 13/18 JetBrains Mono 500.
  static const TextStyle mono = TextStyle(
    fontFamily: AppFontFamily.mono,
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w500,
  );

  /// The scale keyed by its design-token name, for lookup and drift checks.
  static const Map<String, TextStyle> byName = <String, TextStyle>{
    'display-xl': displayXl,
    'display-l': displayL,
    'display-m': displayM,
    'title': title,
    'body-lg': bodyLg,
    'body': body,
    'body-strong': bodyStrong,
    'label': label,
    'meta': meta,
    'mono': mono,
  };
}
