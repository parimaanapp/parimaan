import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_back_chevron.dart';
import 'package:mobile/shared/ui/components/p_top_bar.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

Finder _chevronPaint() => find.descendant(
  of: find.byType(PBackChevron),
  matching: find.byType(CustomPaint),
);

void main() {
  group('PTopBarBackButton semantics', () {
    testWidgets('exposes a tap action and label inside PTopBar', (
      WidgetTester tester,
    ) async {
      int backs = 0;
      await pumpFullWidth(
        tester,
        PTopBar(
          title: 'Pantry',
          onBack: () => backs++,
          backSemanticLabel: 'Back to pantry',
        ),
      );

      await withSemantics(tester, () async {
        final SemanticsNode node = tester.getSemantics(
          find.byType(PTopBarBackButton),
        );
        expect(
          node,
          matchesSemantics(
            label: 'Back to pantry',
            isButton: true,
            hasTapAction: true,
            hasEnabledState: false,
            isEnabled: false,
            isFocusable: false,
          ),
        );
        tester.semantics.tap(find.semantics.byLabel('Back to pantry'));
        await tester.pump();
        expect(backs, 1);
      });
    });
  });

  group('PTopBarBackButton painting', () {
    testWidgets('strokes a heavy round-capped chevron in ink', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        PTopBar(title: 'Pantry', onBack: () {}, backSemanticLabel: 'Back'),
      );

      expect(
        tester.renderObject(_chevronPaint()),
        paints..something((Symbol method, List<dynamic> args) {
          if (method != #drawPath) {
            return false;
          }
          final Paint paint = args[1] as Paint;
          return paint.color.toARGB32() == AppColors.ink.toARGB32() &&
              paint.style == PaintingStyle.stroke &&
              paint.strokeWidth >= 2.6 &&
              paint.strokeCap == StrokeCap.round;
        }),
      );
    });

    testWidgets('color override reaches the painted chevron', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PTopBarBackButton(
          semanticLabel: 'Back',
          onPressed: () {},
          color: Colors.white,
        ),
      );

      expect(
        tester.widget<PBackChevron>(find.byType(PBackChevron)).color,
        Colors.white,
      );
    });

    testWidgets('shape override becomes the ink splash shape', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PTopBarBackButton(
          semanticLabel: 'Back',
          onPressed: () {},
          shape: const CircleBorder(),
        ),
      );

      final InkWell ink = tester.widget<InkWell>(find.byType(InkWell));
      expect(ink.customBorder, isA<CircleBorder>());
    });

    testWidgets('mirrors the chevron under RTL', (WidgetTester tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.rtl,
          child: Center(child: PBackChevron(color: Colors.black)),
        ),
      );

      expect(
        tester.renderObject(_chevronPaint()),
        paints..something((Symbol method, List<dynamic> args) {
          if (method != #drawPath) {
            return false;
          }
          // LTR path spans x 7.2..15.6 of 24; mirrored spans 8.4..16.8.
          final Rect b = (args[0] as Path).getBounds();
          return b.right > 16.5;
        }),
      );
    });
  });

  group('PTopBarBackButton hit target', () {
    testWidgets('taps near each corner of the 44x44 box hit', (
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

      final Rect r = tester.getRect(find.byType(PTopBarBackButton));
      expect(r.width, greaterThanOrEqualTo(44));
      expect(r.height, greaterThanOrEqualTo(44));
      final List<Offset> corners = <Offset>[
        r.topLeft + const Offset(2, 2),
        r.topRight + const Offset(-2, 2),
        r.bottomLeft + const Offset(2, -2),
        r.bottomRight + const Offset(-2, -2),
      ];
      for (final Offset p in corners) {
        await tester.tapAt(p);
        await tester.pump();
      }
      expect(backs, 4);
    });
  });
}
