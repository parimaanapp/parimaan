import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_button.dart';
import 'package:mobile/shared/ui/components/p_icon_button.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

void main() {
  group('PIconButton', () {
    testWidgets('is exactly one min touch target square', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PIconButton(
          icon: Icons.add,
          semanticLabel: 'Add item',
          onPressed: () {},
        ),
      );

      final Size rendered = tester.getSize(find.byType(PIconButton));
      expect(rendered.width, AppSizing.minTouchTargetWidth);
      expect(rendered.height, AppSizing.minTouchTargetHeight);
    });

    testWidgets('calls onPressed when tapped', (WidgetTester tester) async {
      int taps = 0;
      await pumpComponent(
        tester,
        PIconButton(
          icon: Icons.add,
          semanticLabel: 'Add item',
          onPressed: () => taps++,
        ),
      );

      await tester.tap(find.byType(PIconButton));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('is inert when onPressed is null', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        const PIconButton(
          icon: Icons.add,
          semanticLabel: 'Add item',
          onPressed: null,
        ),
      );

      expect(tester.widget<TextButton>(find.byType(TextButton)).enabled, false);
    });

    testWidgets('always carries a semantic label — an icon is not a label', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PIconButton(
          icon: Icons.more_horiz,
          semanticLabel: 'More actions',
          onPressed: () {},
        ),
      );

      await withSemantics(tester, () async {
        expect(find.bySemanticsLabel('More actions'), findsWidgets);
      });
    });

    testWidgets('delegates styling to PButton.icon (single source of truth)', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PIconButton(
          icon: Icons.add,
          semanticLabel: 'Add item',
          variant: PButtonVariant.primary,
          onPressed: () {},
        ),
      );

      expect(find.byType(PButton), findsOneWidget);
      final ButtonStyle style = tester
          .widget<TextButton>(find.byType(TextButton))
          .style!;
      expect(
        style.backgroundColor!.resolve(<WidgetState>{}),
        AppColors.terracotta,
      );
    });

    testWidgets('renders the icon at the nav icon size', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PIconButton(
          icon: Icons.add,
          semanticLabel: 'Add item',
          onPressed: () {},
        ),
      );

      expect(tester.widget<Icon>(find.byType(Icon)).size, AppSizing.icon20);
    });
  });
}
