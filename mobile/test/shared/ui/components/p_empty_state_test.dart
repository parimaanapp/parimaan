import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_button.dart';
import 'package:mobile/shared/ui/components/p_card.dart';
import 'package:mobile/shared/ui/components/p_empty_state.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

PEmptyState _emptyState({Widget? illustration, VoidCallback? onAction}) =>
    PEmptyState(
      illustration: illustration,
      headline: 'The week is a blank page',
      body:
          'Auto-fill from what your household usually rotates through, '
          'or pick meal by meal.',
      action: PButton(
        label: 'Auto-fill the week',
        onPressed: onAction ?? () {},
      ),
    );

void main() {
  group('PEmptyState', () {
    testWidgets('renders headline, body and action', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, _emptyState(), width: 360);

      expect(find.text('The week is a blank page'), findsOneWidget);
      expect(find.textContaining('Auto-fill from what'), findsOneWidget);
      expect(find.byType(PButton), findsOneWidget);
    });

    testWidgets('headline is serif italic', (WidgetTester tester) async {
      await pumpComponent(tester, _emptyState(), width: 360);

      final Text headline = tester.widget<Text>(
        find.text('The week is a blank page'),
      );
      expect(headline.style!.fontFamily, AppFontFamily.display);
      expect(headline.style!.fontStyle, FontStyle.italic);
    });

    testWidgets('the action is reachable — no dead ends', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpComponent(
        tester,
        _emptyState(onAction: () => taps++),
        width: 360,
      );

      await tester.tap(find.byType(PButton));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('falls back to a placeholder illustration slot', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, _emptyState(), width: 360);

      final Size slot = tester.getSize(find.byKey(PEmptyState.illustrationKey));
      expect(slot.width, PEmptyState.illustrationSize);
      expect(slot.height, PEmptyState.illustrationSize);
    });

    testWidgets('honours a caller-supplied illustration', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        _emptyState(illustration: const Text('🍲')),
        width: 360,
      );

      expect(find.text('🍲'), findsOneWidget);
      expect(find.byKey(PEmptyState.illustrationKey), findsNothing);
    });

    testWidgets('sits on a card surface', (WidgetTester tester) async {
      await pumpComponent(tester, _emptyState(), width: 360);

      expect(find.byType(PCard), findsOneWidget);
    });

    testWidgets('body copy uses a readable ink, never the meta ink', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, _emptyState(), width: 360);

      final Text body = tester.widget<Text>(
        find.textContaining('Auto-fill from what'),
      );
      expect(body.style!.color, AppColors.inkSoft);
    });
  });
}
