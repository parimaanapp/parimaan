import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_badge.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

void main() {
  group('PAiBadge', () {
    testWidgets('reads "◆ AI PROPOSAL" in mono caps', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PAiBadge());

      final Text text = tester.widget<Text>(find.text('◆ AI PROPOSAL'));
      expect(text.style!.fontFamily, AppFontFamily.mono);
      expect(text.style!.fontWeight, FontWeight.w600);
      expect(text.style!.color, AppColors.haldiSoftForeground);
    });

    testWidgets('is a haldi-soft pill, never the info blue', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PAiBadge());

      final Container pill = tester.widget<Container>(
        find.descendant(
          of: find.byType(PAiBadge),
          matching: find.byType(Container),
        ),
      );
      final BoxDecoration decoration = pill.decoration! as BoxDecoration;
      expect(decoration.color, AppColors.haldiSoft);
      expect(decoration.color, isNot(AppColors.info));
      expect(decoration.borderRadius, AppRadius.borderFull);
    });

    testWidgets('announces itself as "AI proposal" to screen readers', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PAiBadge());

      await withSemantics(tester, () async {
        expect(find.bySemanticsLabel('AI proposal'), findsOneWidget);
      });
    });
  });
}
