import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_chip.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

BoxDecoration _decoration(WidgetTester tester) =>
    tester
            .widget<Container>(
              find.descendant(
                of: find.byType(PChip),
                matching: find.byType(Container),
              ),
            )
            .decoration!
        as BoxDecoration;

void main() {
  group('PChip — filter variant', () {
    testWidgets('renders its label', (WidgetTester tester) async {
      await pumpComponent(tester, const PChip(label: 'All roles'));

      expect(find.text('All roles'), findsOneWidget);
    });

    testWidgets('unselected is outlined, not filled', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PChip(label: 'Carb', onTap: () {}));

      final BoxDecoration decoration = _decoration(tester);
      expect(decoration.color!.a, 0);
      expect(decoration.border, isNotNull);
      expect(decoration.borderRadius, AppRadius.borderFull);
    });

    testWidgets('selected inverts to ink and adds a tick — not colour alone', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PChip(label: 'Carb', selected: true, onTap: () {}),
      );

      expect(_decoration(tester).color, AppColors.ink);
      expect(find.text(PChip.selectedGlyph), findsOneWidget);
    });

    testWidgets('calls onTap', (WidgetTester tester) async {
      int taps = 0;
      await pumpComponent(tester, PChip(label: 'Carb', onTap: () => taps++));

      await tester.tap(find.byType(PChip));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('an interactive chip clears the min touch target', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PChip(label: 'Carb', onTap: () {}));

      final Size size = tester.getSize(find.byType(PChip));
      expect(size.height, greaterThanOrEqualTo(AppSizing.minTouchTargetHeight));
      expect(size.width, greaterThanOrEqualTo(AppSizing.minTouchTargetWidth));
    });

    testWidgets('exposes its selected state to screen readers', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PChip(label: 'Carb', selected: true, onTap: () {}),
      );

      await withSemantics(tester, () async {
        expect(
          tester.getSemantics(find.byType(PChip)),
          isSemantics(isSelected: true),
        );
      });
    });
  });

  group('PChip — tag variant', () {
    testWidgets('is a small square-cornered tinted tag', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PChip(
          label: 'veg',
          variant: PChipVariant.tag,
          tone: PChipTone.veg,
        ),
      );

      final BoxDecoration decoration = _decoration(tester);
      expect(decoration.color, AppColors.cardamomSoft);
      expect(decoration.borderRadius, AppRadius.borderXs);
      expect(
        tester.widget<Text>(find.text('veg')).style!.color,
        AppColors.cardamomSoftForeground,
      );
    });

    testWidgets('a non-interactive tag is exempt from the touch-target floor', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PChip(label: 'veg', variant: PChipVariant.tag),
      );

      expect(
        find.descendant(of: find.byType(PChip), matching: find.byType(InkWell)),
        findsNothing,
      );
      expect(
        tester.getSize(find.byType(PChip)).height,
        lessThan(AppSizing.minTouchTargetHeight),
      );
    });

    testWidgets('every tone pairs its colour with the label text', (
      WidgetTester tester,
    ) async {
      for (final PChipTone tone in PChipTone.values) {
        await pumpComponent(
          tester,
          PChip(label: tone.name, variant: PChipVariant.tag, tone: tone),
        );
        expect(find.text(tone.name), findsOneWidget);
      }
    });
  });

  group('PChip — removable', () {
    testWidgets('shows a remove affordance and calls back', (
      WidgetTester tester,
    ) async {
      int removed = 0;
      await pumpComponent(
        tester,
        PChip(
          label: 'Punjabi',
          selected: true,
          onRemove: () => removed++,
          removeSemanticLabel: 'Remove Punjabi',
        ),
      );

      await tester.tap(find.text(PChip.removeGlyph));
      await tester.pump();

      expect(removed, 1);
    });

    testWidgets('remove control meets the 44pt touch-target floor', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PChip(
          label: 'Punjabi',
          selected: true,
          onRemove: () {},
          removeSemanticLabel: 'Remove Punjabi',
        ),
      );

      final Size removeButtonSize = tester.getSize(
        find.ancestor(
          of: find.text(PChip.removeGlyph),
          matching: find.byType(SizedBox),
        ),
      );
      expect(
        removeButtonSize.width,
        greaterThanOrEqualTo(AppSizing.minTouchTargetWidth),
      );
      expect(
        removeButtonSize.height,
        greaterThanOrEqualTo(AppSizing.minTouchTargetHeight),
      );
    });

    testWidgets('requires a semantic label for the remove control', (
      WidgetTester tester,
    ) async {
      expect(
        () => PChip(label: 'Punjabi', onRemove: () {}),
        throwsAssertionError,
      );
    });
  });
}
