// Drift guard: this test is the mechanism that keeps the Dart token files in
// `lib/shared/ui/` in lockstep with `shared/design-tokens.json`, which is the
// single source of truth for the design system.
//
// It reads the JSON from disk at test time and asserts that every ported value
// is byte-for-byte the same. If a designer changes the JSON and nobody updates
// Dart (or vice versa), this test fails.
//
// Path note: `flutter test` runs with the package root (`mobile/`) as CWD, and
// `shared/` is a sibling of `mobile/` in the monorepo — hence `../shared/`.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/theme.dart';
import 'package:mobile/shared/ui/tokens.dart';

/// Relative to the `mobile/` package root, which is the CWD for `flutter test`.
const String kTokensJsonPath = '../shared/design-tokens.json';

/// `#RRGGBB` -> opaque ARGB int, e.g. `#FBF6EE` -> 0xFFFBF6EE.
int argbFromHex(String hex) {
  final String cleaned = hex.replaceFirst('#', '');
  return int.parse('FF$cleaned', radix: 16);
}

/// Parses one CSS shadow, e.g. `0 4px 12px rgba(31,26,21,0.06)`.
({Offset offset, double blur, int rgb, double alpha}) parseShadow(String css) {
  final RegExpMatch? m = RegExp(
    r'^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+'
    r'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$',
  ).firstMatch(css.trim());
  if (m == null) {
    throw FormatException('Unparseable shadow spec in design-tokens.json', css);
  }
  double g(int i) => double.parse(m.group(i)!);
  int gi(int i) => int.parse(m.group(i)!);
  return (
    offset: Offset(g(1), g(2)),
    blur: g(3),
    rgb: (gi(4) << 16) | (gi(5) << 8) | gi(6),
    alpha: g(7),
  );
}

List<String> splitShadowList(String css) =>
    css.split(RegExp(r',(?![^(]*\))')).map((String s) => s.trim()).toList();

/// `cubic-bezier(0.2, 0, 0, 1)` -> the four control-point values.
List<double> parseCubicBezier(String css) {
  final RegExpMatch? m = RegExp(
    r'^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*'
    r'(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$',
  ).firstMatch(css.trim());
  if (m == null) {
    throw FormatException('Unparseable easing in design-tokens.json', css);
  }
  return <double>[for (int i = 1; i <= 4; i++) double.parse(m.group(i)!)];
}

void expectShadowMatches(BoxShadow actual, String css, String label) {
  final ({Offset offset, double blur, int rgb, double alpha}) want =
      parseShadow(css);
  expect(actual.offset, want.offset, reason: '$label offset');
  expect(actual.blurRadius, want.blur, reason: '$label blurRadius');
  expect(actual.spreadRadius, 0.0, reason: '$label spreadRadius');
  expect(
    actual.color.toARGB32() & 0x00FFFFFF,
    want.rgb,
    reason: '$label shadow rgb',
  );
  expect(actual.color.a, closeTo(want.alpha, 0.005), reason: '$label alpha');
}

void main() {
  late Map<String, dynamic> tokens;

  setUpAll(() {
    final File file = File(kTokensJsonPath);
    expect(
      file.existsSync(),
      isTrue,
      reason:
          'design-tokens.json not found at $kTokensJsonPath '
          '(CWD is ${Directory.current.path})',
    );
    tokens = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  });

  Map<String, dynamic> section(String key) =>
      tokens[key] as Map<String, dynamic>;

  Map<String, dynamic> colorGroup(String group) =>
      section('color')[group] as Map<String, dynamic>;

  String colorHex(String group, String name) =>
      (colorGroup(group)[name] as Map<String, dynamic>)['hex'] as String;

  group('AppColors mirrors color.* in design-tokens.json', () {
    void expectColor(String group, String name, Color actual) {
      test('$group.$name', () {
        expect(actual.toARGB32(), argbFromHex(colorHex(group, name)));
      });
    }

    expectColor('neutral', 'paper', AppColors.paper);
    expectColor('neutral', 'paper2', AppColors.paper2);
    expectColor('neutral', 'card', AppColors.card);
    expectColor('neutral', 'inkSoft', AppColors.inkSoft);
    expectColor('neutral', 'inkMid', AppColors.inkMid);
    expectColor('neutral', 'ink', AppColors.ink);

    expectColor('brand', 'haldiSoft', AppColors.haldiSoft);
    expectColor('brand', 'haldi', AppColors.haldi);
    expectColor('brand', 'terracotta', AppColors.terracotta);
    expectColor('brand', 'terracottaDeep', AppColors.terracottaDeep);
    expectColor('brand', 'cardamom', AppColors.cardamom);
    expectColor('brand', 'cardamomSoft', AppColors.cardamomSoft);

    expectColor('semantic', 'success', AppColors.success);
    expectColor('semantic', 'warning', AppColors.warning);
    expectColor('semantic', 'danger', AppColors.danger);
    expectColor('semantic', 'info', AppColors.info);

    test('brand.cardamomSoft.foreground', () {
      final String hex =
          (colorGroup('brand')['cardamomSoft']
                  as Map<String, dynamic>)['foreground']
              as String;
      expect(AppColors.cardamomSoftForeground.toARGB32(), argbFromHex(hex));
    });

    test('no color in the JSON is missing from AppColors', () {
      final Set<String> jsonNames = <String>{
        for (final String g in <String>['neutral', 'brand', 'semantic'])
          ...colorGroup(g).keys,
      };
      const Set<String> dartNames = <String>{
        'paper', 'paper2', 'card', 'inkSoft', 'inkMid', 'ink', //
        'haldiSoft', 'haldi', 'terracotta', 'terracottaDeep',
        'cardamom', 'cardamomSoft',
        'success', 'warning', 'danger', 'info',
      };
      expect(jsonNames.difference(dartNames), isEmpty);
      expect(dartNames.difference(jsonNames), isEmpty);
    });
  });

  group('AppSpacing mirrors spacing.scale', () {
    late Map<String, double> jsonSpacing;
    late Map<String, double> dartSpacing;

    setUpAll(() {
      jsonSpacing = <String, double>{
        for (final dynamic e in section('spacing')['scale'] as List<dynamic>)
          (e as Map<String, dynamic>)['name'] as String: (e['px'] as num)
              .toDouble(),
      };
      dartSpacing = const <String, double>{
        's0': AppSpacing.s0,
        's1': AppSpacing.s1,
        's2': AppSpacing.s2,
        's3': AppSpacing.s3,
        's4': AppSpacing.s4,
        's5': AppSpacing.s5,
        's6': AppSpacing.s6,
        's7': AppSpacing.s7,
      };
    });

    test('every step matches, and there are no extras or omissions', () {
      expect(dartSpacing, jsonSpacing);
    });

    test('baseUnit matches', () {
      expect(
        AppSpacing.baseUnit,
        (section('spacing')['baseUnit'] as num).toDouble(),
      );
    });
  });

  group('AppRadius mirrors radius.scale', () {
    late Map<String, double> jsonRadius;
    late Map<String, double> dartRadius;

    setUpAll(() {
      jsonRadius = <String, double>{
        for (final dynamic e in section('radius')['scale'] as List<dynamic>)
          (e as Map<String, dynamic>)['name'] as String: (e['px'] as num)
              .toDouble(),
      };
      dartRadius = const <String, double>{
        'r-xs': AppRadius.xs,
        'r-s': AppRadius.s,
        'r-m': AppRadius.m,
        'r-l': AppRadius.l,
        'r-xl': AppRadius.xl,
        'r-full': AppRadius.full,
      };
    });

    test('every step matches, and there are no extras or omissions', () {
      expect(dartRadius, jsonRadius);
    });

    test('BorderRadius helpers use the same numbers', () {
      expect(AppRadius.borderXs, BorderRadius.circular(jsonRadius['r-xs']!));
      expect(AppRadius.borderS, BorderRadius.circular(jsonRadius['r-s']!));
      expect(AppRadius.borderM, BorderRadius.circular(jsonRadius['r-m']!));
      expect(AppRadius.borderL, BorderRadius.circular(jsonRadius['r-l']!));
      expect(AppRadius.borderXl, BorderRadius.circular(jsonRadius['r-xl']!));
      expect(
        AppRadius.borderFull,
        BorderRadius.circular(jsonRadius['r-full']!),
      );
    });
  });

  group('AppElevation mirrors elevation.levels', () {
    Map<String, dynamic> level(String name) =>
        (section('elevation')['levels'] as List<dynamic>)
            .cast<Map<String, dynamic>>()
            .firstWhere((Map<String, dynamic> e) => e['name'] == name);

    test('e0 is border-only, so it carries no shadow', () {
      expect(level('e0')['shadow'], 'border only');
      expect(AppElevation.e0, isEmpty);
    });

    test('e1 matches its shadow spec', () {
      final List<String> specs = splitShadowList(
        level('e1')['shadow'] as String,
      );
      expect(AppElevation.e1, hasLength(specs.length));
      for (int i = 0; i < specs.length; i++) {
        expectShadowMatches(AppElevation.e1[i], specs[i], 'e1[$i]');
      }
    });

    test('e2 matches its shadow spec', () {
      final List<String> specs = splitShadowList(
        level('e2')['shadow'] as String,
      );
      expect(AppElevation.e2, hasLength(specs.length));
      for (int i = 0; i < specs.length; i++) {
        expectShadowMatches(AppElevation.e2[i], specs[i], 'e2[$i]');
      }
    });

    test('no colored shadows — every shadow is the ink hue', () {
      final int inkRgb = argbFromHex(colorHex('neutral', 'ink')) & 0x00FFFFFF;
      for (final BoxShadow s in <BoxShadow>[
        ...AppElevation.e1,
        ...AppElevation.e2,
      ]) {
        expect(s.color.toARGB32() & 0x00FFFFFF, inkRgb);
      }
    });
  });

  group('AppMotion mirrors motion.*', () {
    Map<String, dynamic> durations() =>
        section('motion')['duration'] as Map<String, dynamic>;
    Map<String, dynamic> easings() =>
        section('motion')['easing'] as Map<String, dynamic>;

    test('all four durations match', () {
      final Map<String, Duration> dart = const <String, Duration>{
        'instant': AppMotion.instant,
        'quick': AppMotion.quick,
        'standard': AppMotion.standard,
        'gentle': AppMotion.gentle,
      };
      final Map<String, Duration> json = <String, Duration>{
        for (final MapEntry<String, dynamic> e in durations().entries)
          e.key: Duration(milliseconds: (e.value as num).toInt()),
      };
      expect(dart, json);
    });

    test('all three easings match their cubic-bezier control points', () {
      final Map<String, Cubic> dart = const <String, Cubic>{
        'standard': AppMotion.easeStandard,
        'emphasized': AppMotion.easeEmphasized,
        'exit': AppMotion.easeExit,
      };
      expect(dart.keys.toSet(), easings().keys.toSet());
      easings().forEach((String name, dynamic css) {
        final List<double> want = parseCubicBezier(css as String);
        final Cubic got = dart[name]!;
        expect(<double>[got.a, got.b, got.c, got.d], want, reason: name);
      });
    });
  });

  group('AppTypography mirrors typography.scale', () {
    late Map<String, Map<String, dynamic>> jsonScale;

    setUpAll(() {
      jsonScale = <String, Map<String, dynamic>>{
        for (final dynamic e in section('typography')['scale'] as List<dynamic>)
          (e as Map<String, dynamic>)['name'] as String: e,
      };
    });

    void expectStyle(String name, TextStyle actual) {
      test(name, () {
        final Map<String, dynamic> want = jsonScale[name]!;
        final double size = (want['size'] as num).toDouble();
        final double lineHeight = (want['lineHeight'] as num).toDouble();
        expect(actual.fontFamily, want['family'], reason: '$name family');
        expect(actual.fontSize, size, reason: '$name size');
        expect(actual.height, lineHeight / size, reason: '$name height');
        expect(
          actual.fontWeight,
          FontWeight.values.firstWhere(
            (FontWeight w) => w.value == (want['weight'] as num).toInt(),
          ),
          reason: '$name weight',
        );
        final num? em = want['letterSpacing'] as num?;
        expect(
          actual.letterSpacing,
          em == null ? isNull : em.toDouble() * size,
          reason: '$name letterSpacing (em -> logical px)',
        );
      });
    }

    expectStyle('display-xl', AppTypography.displayXl);
    expectStyle('display-l', AppTypography.displayL);
    expectStyle('display-m', AppTypography.displayM);
    expectStyle('title', AppTypography.title);
    expectStyle('body-lg', AppTypography.bodyLg);
    expectStyle('body', AppTypography.body);
    expectStyle('body-strong', AppTypography.bodyStrong);
    expectStyle('label', AppTypography.label);
    expectStyle('meta', AppTypography.meta);
    expectStyle('mono', AppTypography.mono);

    test('every scale entry in the JSON has a Dart counterpart', () {
      expect(AppTypography.byName.keys.toSet(), jsonScale.keys.toSet());
    });

    test('font families match typography.families', () {
      final Map<String, dynamic> fams =
          section('typography')['families'] as Map<String, dynamic>;
      expect(AppFontFamily.display, fams['display']);
      expect(AppFontFamily.ui, fams['ui']);
      expect(AppFontFamily.wordmark, fams['wordmark']);
      expect(AppFontFamily.mono, fams['mono']);
    });
  });

  group('AppSizing mirrors accessibility / iconography / componentRules', () {
    test('minimum touch target', () {
      final Map<String, dynamic> t =
          section('accessibility')['minTouchTarget'] as Map<String, dynamic>;
      expect(AppSizing.minTouchTargetWidth, (t['width'] as num).toDouble());
      expect(AppSizing.minTouchTargetHeight, (t['height'] as num).toDouble());
    });

    test('focus ring widths', () {
      final String spec = section('accessibility')['focusRing'] as String;
      final List<RegExpMatch> px = RegExp(r'(\d+)px').allMatches(spec).toList();
      expect(px, hasLength(2));
      expect(AppSizing.focusRingWidth, double.parse(px[0].group(1)!));
      expect(AppSizing.focusRingSpacer, double.parse(px[1].group(1)!));
    });

    test('button minimum height', () {
      expect(
        AppSizing.buttonMinHeight,
        ((section('componentRules')['buttons']
                    as Map<String, dynamic>)['minHeight']
                as num)
            .toDouble(),
      );
    });

    test('icon sizes', () {
      final List<double> json =
          (section('iconography')['sizes'] as List<dynamic>)
              .map(
                (dynamic e) =>
                    double.parse((e as Map<String, dynamic>)['name'] as String),
              )
              .toList();
      expect(AppSizing.iconSizes, json);
    });
  });

  group('parimaanTheme is wired to the tokens', () {
    late ThemeData theme;

    setUpAll(() => theme = parimaanTheme());

    test('colorScheme maps brand + semantic colors', () {
      expect(theme.colorScheme.primary, AppColors.terracotta);
      expect(theme.colorScheme.secondary, AppColors.cardamom);
      expect(theme.colorScheme.error, AppColors.danger);
      expect(theme.colorScheme.surface, AppColors.card);
      expect(theme.scaffoldBackgroundColor, AppColors.paper);
      expect(theme.colorScheme.brightness, Brightness.light);
    });

    test('textTheme is built from the typography scale', () {
      // The theme adds colour on top of the scale, so compare the metrics
      // that identify the style rather than the whole TextStyle.
      void expectSlot(TextStyle? actual, TextStyle want, String slot) {
        expect(actual?.fontFamily, want.fontFamily, reason: '$slot family');
        expect(actual?.fontSize, want.fontSize, reason: '$slot size');
        expect(actual?.height, want.height, reason: '$slot height');
        expect(actual?.fontWeight, want.fontWeight, reason: '$slot weight');
        expect(
          actual?.letterSpacing,
          want.letterSpacing,
          reason: '$slot letterSpacing',
        );
        expect(actual?.color, isNotNull, reason: '$slot colour');
      }

      expectSlot(
        theme.textTheme.displayLarge,
        AppTypography.displayXl,
        'displayLarge',
      );
      expectSlot(theme.textTheme.titleLarge, AppTypography.title, 'titleLarge');
      expectSlot(theme.textTheme.bodyMedium, AppTypography.body, 'bodyMedium');
      expectSlot(theme.textTheme.labelSmall, AppTypography.meta, 'labelSmall');
    });

    test('buttons honour the 44pt minimum touch target', () {
      for (final ButtonStyle? style in <ButtonStyle?>[
        theme.elevatedButtonTheme.style,
        theme.outlinedButtonTheme.style,
        theme.textButtonTheme.style,
      ]) {
        expect(
          style?.minimumSize?.resolve(<WidgetState>{}),
          const Size(AppSizing.minTouchTargetWidth, AppSizing.buttonMinHeight),
        );
      }
    });
  });
}
