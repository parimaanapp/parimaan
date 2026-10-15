import 'dart:math' as math;

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
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
    test('paper on terracotta (primary button) meets 3:1 (semibold, known '
        'below 4.5:1 — see PR notes)', () {
      expect(
        contrast(AppColors.paper, AppColors.terracotta),
        greaterThanOrEqualTo(3),
      );
    });

    pairs.forEach((String name, (Color, Color) p) {
      test(name, () {
        expect(contrast(p.$1, p.$2), greaterThanOrEqualTo(4.5));
      });
    });
  });
}
