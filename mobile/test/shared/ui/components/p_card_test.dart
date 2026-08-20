import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_card.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

BoxDecoration _decoration(WidgetTester tester) =>
    tester
            .widget<Container>(
              find.descendant(
                of: find.byType(PCard),
                matching: find.byType(Container),
              ),
            )
            .decoration!
        as BoxDecoration;

void main() {
  group('PCard', () {
    testWidgets('renders its child', (WidgetTester tester) async {
      await pumpComponent(tester, const PCard(child: Text('42 items')));

      expect(find.text('42 items'), findsOneWidget);
    });

    testWidgets('is a card surface with the card radius', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PCard(child: Text('42 items')));

      final BoxDecoration decoration = _decoration(tester);
      expect(decoration.color, AppColors.card);
      expect(decoration.borderRadius, AppRadius.borderL);
    });

    testWidgets('e0 is border-only — no shadow', (WidgetTester tester) async {
      await pumpComponent(tester, const PCard(child: Text('42 items')));

      final BoxDecoration decoration = _decoration(tester);
      expect(decoration.boxShadow, AppElevation.e0);
      expect(decoration.border, isNotNull);
    });

    testWidgets('e1 and e2 carry their shadow and drop the border', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PCard(elevation: PCardElevation.e1, child: Text('sheet')),
      );
      expect(_decoration(tester).boxShadow, AppElevation.e1);
      expect(_decoration(tester).border, isNull);

      await pumpComponent(
        tester,
        const PCard(elevation: PCardElevation.e2, child: Text('modal')),
      );
      expect(_decoration(tester).boxShadow, AppElevation.e2);
    });

    testWidgets('defaults to token padding', (WidgetTester tester) async {
      await pumpComponent(tester, const PCard(child: SizedBox.shrink()));

      expect(
        tester
            .widget<Container>(
              find.descendant(
                of: find.byType(PCard),
                matching: find.byType(Container),
              ),
            )
            .padding,
        const EdgeInsets.all(AppSpacing.s3),
      );
    });
  });

  group('PCard — tappable', () {
    testWidgets('is not interactive without onTap', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PCard(child: Text('42 items')));

      expect(
        find.descendant(of: find.byType(PCard), matching: find.byType(InkWell)),
        findsNothing,
      );
    });

    testWidgets('a tappable card calls back and clears the touch target', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpComponent(
        tester,
        PCard(onTap: () => taps++, child: const Text('42 items')),
      );

      await tester.tap(find.byType(PCard));
      await tester.pump();

      expect(taps, 1);
      expect(
        tester.getSize(find.byType(PCard)).height,
        greaterThanOrEqualTo(AppSizing.minTouchTargetHeight),
      );
    });
  });
}
