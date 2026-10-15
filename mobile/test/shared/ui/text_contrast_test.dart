import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_button.dart';
import 'package:mobile/shared/ui/tokens.dart';

double _lin(double c) =>
    c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();

double _luminance(Color c) =>
    0.2126 * _lin(c.r) + 0.7152 * _lin(c.g) + 0.0722 * _lin(c.b);

double contrast(Color a, Color b) {
  final double la = _luminance(a);
  final double lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  group('text token pairs meet 4.5:1', () {
    final Map<String, (Color, Color)> pairs = <String, (Color, Color)>{
      'ink on paper': (AppColors.ink, AppColors.paper),
      'ink on card': (AppColors.ink, AppColors.card),
      'inkSoft on paper (input label, inactive tab label)': (
        AppColors.inkSoft,
        AppColors.paper,
      ),
      'inkSoft on card (tab bar, field)': (AppColors.inkSoft, AppColors.card),
      'paper on ink (selected chip)': (AppColors.paper, AppColors.ink),
      'haldiSoftForeground on haldiSoft (AI badge)': (
        AppColors.haldiSoftForeground,
        AppColors.haldiSoft,
      ),
    };
    // Pairs below 4.5:1 are only allowed as WCAG "large text": >= 18.66 px
    // (14 pt) bold (>= w600), where 3:1 applies. The style is read from the
    // real button, not restated here.
    for (final PButtonVariant v in <PButtonVariant>[
      PButtonVariant.primary,
      PButtonVariant.affirmative,
      PButtonVariant.dark,
    ]) {
      test('filled button ${v.name}: label pair passes at its real size', () {
        final ButtonStyle style = pButtonStyle(variant: v);
        final Color fg = style.foregroundColor!.resolve(const {})!;
        final Color bg = style.backgroundColor!.resolve(const {})!;
        final TextStyle text = style.textStyle!.resolve(const {})!;
        final double ratio = contrast(fg, bg);
        if (ratio < 4.5) {
          expect(text.fontSize, greaterThanOrEqualTo(18.66));
          expect(text.fontWeight!.value, greaterThanOrEqualTo(600));
          expect(ratio, greaterThanOrEqualTo(3));
        }
      });
    }

    test('small accent tags (badge, chip) clear 4.5:1 at their small size', () {
      expect(
        contrast(AppColors.paper, AppColors.terracottaDeep),
        greaterThanOrEqualTo(4.5),
      );
    });

    pairs.forEach((String name, (Color, Color) p) {
      test(name, () {
        expect(contrast(p.$1, p.$2), greaterThanOrEqualTo(4.5));
      });
    });
  });
}
