import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_badge.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

BoxDecoration _decoration(WidgetTester tester) =>
    tester
            .widget<Container>(
              find.descendant(
                of: find.byType(PBadge),
                matching: find.byType(Container),
              ),
            )
            .decoration!
        as BoxDecoration;

void main() {
  group('PBadge', () {
    testWidgets('uppercases its label by default (meta style)', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PBadge(label: 'AI suggests'));

      expect(find.text('AI SUGGESTS'), findsOneWidget);
      final Text text = tester.widget<Text>(find.text('AI SUGGESTS'));
      expect(text.style!.fontSize, AppTypography.meta.fontSize);
      expect(text.style!.letterSpacing, AppTypography.meta.letterSpacing);
    });

    testWidgets('can keep the caller casing', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        const PBadge(label: 'AI suggests', uppercase: false),
      );

      expect(find.text('AI suggests'), findsOneWidget);
    });

    testWidgets('is a pill', (WidgetTester tester) async {
      await pumpComponent(tester, const PBadge(label: 'new'));

      expect(_decoration(tester).borderRadius, AppRadius.borderFull);
    });

    testWidgets('every tone renders text alongside its colour', (
      WidgetTester tester,
    ) async {
      for (final PBadgeTone tone in PBadgeTone.values) {
        await pumpComponent(tester, PBadge(label: tone.name, tone: tone));
        expect(
          find.text(tone.name.toUpperCase()),
          findsOneWidget,
          reason: 'colour must never be the only signal (${tone.name})',
        );
      }
    });

    testWidgets('warning tone uses the haldi surface pair', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PBadge(label: 'expiring', tone: PBadgeTone.warning),
      );

      expect(_decoration(tester).color, AppColors.haldiSoft);
      expect(
        tester.widget<Text>(find.text('EXPIRING')).style!.color,
        AppColors.ink,
      );
    });

    testWidgets('renders an optional caller-supplied icon at inline size', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PBadge(label: 'synced', icon: Icons.check),
      );

      expect(tester.widget<Icon>(find.byType(Icon)).size, AppSizing.icon16);
    });

    testWidgets('is not interactive — badges are status, not controls', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PBadge(label: 'new'));

      expect(
        find.descendant(
          of: find.byType(PBadge),
          matching: find.byType(InkWell),
        ),
        findsNothing,
      );
      expect(
        find.descendant(
          of: find.byType(PBadge),
          matching: find.byType(GestureDetector),
        ),
        findsNothing,
      );
    });
  });

  group('PBadge.count', () {
    testWidgets('renders the count in the mono face', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PBadge.count(count: 42));

      final Text text = tester.widget<Text>(find.text('42'));
      expect(text.style!.fontFamily, AppFontFamily.mono);
    });

    testWidgets('rejects a negative count', (WidgetTester tester) async {
      expect(() => PBadge.count(count: -1), throwsAssertionError);
    });
  });
}
