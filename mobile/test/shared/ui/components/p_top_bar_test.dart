import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_top_bar.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

void main() {
  group('PTopBar', () {
    testWidgets('renders the title in the display serif', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, const PTopBar(title: 'Pantry'));

      final Text title = tester.widget<Text>(find.text('Pantry'));
      expect(title.style!.fontFamily, AppFontFamily.display);
      expect(title.style!.fontSize, AppTypography.displayM.fontSize);
    });

    testWidgets('renders an optional subtitle', (WidgetTester tester) async {
      await pumpFullWidth(
        tester,
        const PTopBar(title: 'Pantry', subtitle: '42 items · updated 2m ago'),
      );

      expect(find.text('42 items · updated 2m ago'), findsOneWidget);
    });

    testWidgets('has no back affordance unless onBack is given', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, const PTopBar(title: 'Pantry'));

      expect(find.byType(PTopBarBackButton), findsNothing);
    });

    testWidgets('back button calls onBack and meets the touch target', (
      WidgetTester tester,
    ) async {
      int backs = 0;
      await pumpFullWidth(
        tester,
        PTopBar(
          title: 'Pantry',
          onBack: () => backs++,
          backSemanticLabel: 'Back',
        ),
      );

      final Size size = tester.getSize(find.byType(PTopBarBackButton));
      expect(size.height, greaterThanOrEqualTo(AppSizing.minTouchTargetHeight));
      expect(size.width, greaterThanOrEqualTo(AppSizing.minTouchTargetWidth));

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pump();

      expect(backs, 1);
    });

    testWidgets('back button exposes the caller-supplied semantic label', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        PTopBar(
          title: 'Pantry',
          onBack: () {},
          backSemanticLabel: 'Back to settings',
        ),
      );

      await withSemantics(tester, () async {
        expect(find.bySemanticsLabel('Back to settings'), findsWidgets);
      });
    });

    testWidgets('renders an optional trailing action', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        const PTopBar(title: 'Pantry', trailing: Text('⋯')),
      );

      expect(find.text('⋯'), findsOneWidget);
    });

    testWidgets('marks the title as a heading for screen readers', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, const PTopBar(title: 'Pantry'));

      await withSemantics(tester, () async {
        expect(
          tester.getSemantics(find.text('Pantry')),
          isSemantics(label: 'Pantry', isHeader: true),
        );
      });
    });

    testWidgets('asserts a semantic label whenever onBack is supplied', (
      WidgetTester tester,
    ) async {
      expect(
        () => PTopBar(title: 'Pantry', onBack: () {}),
        throwsAssertionError,
      );
    });
  });
}
