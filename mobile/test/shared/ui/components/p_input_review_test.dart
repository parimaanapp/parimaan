import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_input.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

BoxDecoration _ring(WidgetTester tester) =>
    tester.widget<DecoratedBox>(find.byKey(PInput.focusRingKey)).decoration
        as BoxDecoration;

void main() {
  group('PInput — contrast', () {
    testWidgets('label is inkSoft, not inkMid', (WidgetTester tester) async {
      await pumpComponent(tester, const PInput(label: 'Name'), width: 320);

      final Text label = tester.widget<Text>(find.text('NAME'));
      expect(label.style!.color, AppColors.inkSoft);
      expect(label.style!.fontSize, greaterThanOrEqualTo(11));
    });

    testWidgets('helper text is inkSoft', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Name', helperText: 'Six characters'),
        width: 320,
      );

      expect(
        tester.widget<Text>(find.text('Six characters')).style!.color,
        AppColors.inkSoft,
      );
    });
  });

  group('PInput — semantics', () {
    testWidgets('field node exposes the original-case label and the error', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Invite code', errorText: 'That code expired.'),
        width: 320,
      );

      await withSemantics(tester, () async {
        final SemanticsNode node = tester.getSemantics(
          find.byType(TextField),
        );
        final SemanticsData data = node.getSemanticsData();
        expect(data.label, contains('Invite code'));
        expect('${data.label} ${data.hint} ${data.value}',
            contains('That code expired.'));
        expect(find.bySemanticsLabel('INVITE CODE'), findsNothing);
      });
    });

    testWidgets('the error message is a live region', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Invite code', errorText: 'That code expired.'),
        width: 320,
      );

      await withSemantics(tester, () async {
        final SemanticsNode node = tester.getSemantics(
          find.text('That code expired.'),
        );
        expect(node.getSemanticsData().flagsCollection.isLiveRegion, isTrue);
      });
    });
  });

  group('PInput — focus ring', () {
    testWidgets('hugs the text field box, not the row with a trailing', (
      WidgetTester tester,
    ) async {
      final FocusNode node = FocusNode();
      addTearDown(node.dispose);
      await pumpComponent(
        tester,
        PInput(
          label: 'Quantity',
          focusNode: node,
          trailing: const SizedBox(width: 60, height: 44),
        ),
        width: 320,
      );

      expect(
        tester.getRect(find.byKey(PInput.focusRingKey)),
        tester.getRect(find.byType(TextField)),
      );
    });

    testWidgets('is danger@12% while focused in error', (
      WidgetTester tester,
    ) async {
      final FocusNode node = FocusNode();
      addTearDown(node.dispose);
      await pumpComponent(
        tester,
        PInput(label: 'Code', focusNode: node, errorText: 'Bad code'),
        width: 320,
      );
      node.requestFocus();
      await tester.pump();

      expect(
        _ring(tester).boxShadow!.single.color,
        AppColors.dangerRing,
      );
    });

    testWidgets('is not clipped inside a padded scroll view', (
      WidgetTester tester,
    ) async {
      final FocusNode node = FocusNode();
      addTearDown(node.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: PInput(label: 'Name', focusNode: node),
            ),
          ),
        ),
      );
      node.requestFocus();
      await tester.pump();

      final Rect box = tester.getRect(find.byKey(PInput.focusRingKey));
      final Rect viewport = tester.getRect(find.byType(SingleChildScrollView));
      expect(viewport.contains(box.inflate(3).topLeft), isTrue);
      expect(viewport.contains(box.inflate(3).bottomRight), isTrue);
      expect(_ring(tester).boxShadow, isNotNull);
    });
  });
}
