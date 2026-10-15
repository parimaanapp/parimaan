import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_back_chevron.dart';
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

    testWidgets('centres the title on the bar, with or without slots', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, const PTopBar(title: 'Pantry'));
      final double barCentre = tester.getCenter(find.byType(PTopBar)).dx;
      expect(tester.getCenter(find.text('Pantry')).dx, closeTo(barCentre, 0.5));

      await pumpFullWidth(
        tester,
        PTopBar(
          title: 'Pantry',
          onBack: () {},
          backSemanticLabel: 'Back',
          trailing: const Text('2/4'),
        ),
      );
      expect(tester.getCenter(find.text('Pantry')).dx, closeTo(barCentre, 0.5));
      final Text title = tester.widget<Text>(find.text('Pantry'));
      expect(title.textAlign, TextAlign.center);
    });

    testWidgets('back sits at the left edge and trailing at the right on the '
        'title row', (WidgetTester tester) async {
      await pumpFullWidth(
        tester,
        PTopBar(
          title: 'Pantry',
          onBack: () {},
          backSemanticLabel: 'Back',
          trailing: const Text('2/4'),
        ),
      );

      final double titleY = tester.getCenter(find.text('Pantry')).dy;
      final Offset back = tester.getCenter(find.byType(PTopBarBackButton));
      final Offset trailing = tester.getCenter(find.text('2/4'));
      final double mid = tester.getCenter(find.byType(PTopBar)).dx;
      expect(back.dx, lessThan(mid));
      expect(trailing.dx, greaterThan(mid));
      expect(back.dy, closeTo(titleY, 6));
      expect(trailing.dy, closeTo(titleY, 6));
    });

    testWidgets('renders a centred optional subtitle below the title', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        const PTopBar(title: 'Pantry', subtitle: '42 items'),
      );

      final double barCentre = tester.getCenter(find.byType(PTopBar)).dx;
      expect(tester.getCenter(find.text('42 items')).dx, closeTo(barCentre, 0.5));
      expect(
        tester.getTopLeft(find.text('42 items')).dy,
        greaterThan(tester.getBottomLeft(find.text('Pantry')).dy - 1),
      );
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

    testWidgets('back chevron is bold, 24px and ink-coloured', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        PTopBar(title: 'Pantry', onBack: () {}, backSemanticLabel: 'Back'),
      );

      final Finder chevron = find.byType(PBackChevron);
      expect(chevron, findsOneWidget);
      final Size size = tester.getSize(chevron);
      expect(size.width, greaterThanOrEqualTo(24));
      expect(size.height, greaterThanOrEqualTo(24));
      final PBackChevron widget = tester.widget<PBackChevron>(chevron);
      expect(widget.color, AppColors.ink);
      expect(widget.strokeWidth, greaterThanOrEqualTo(2.6));
    });

    testWidgets('back button has an ink response', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        PTopBar(title: 'Pantry', onBack: () {}, backSemanticLabel: 'Back'),
      );

      expect(
        find.descendant(
          of: find.byType(PTopBarBackButton),
          matching: find.byType(InkWell),
        ),
        findsOneWidget,
      );
    });

    testWidgets('an explicit text glyph renders as text, null draws chevron', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        PTopBar(
          title: 'Pantry',
          onBack: () {},
          backSemanticLabel: 'Back',
          backGlyph: '<',
        ),
      );

      expect(find.text('<'), findsOneWidget);
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
