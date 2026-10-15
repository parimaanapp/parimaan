import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/components.dart';

import '../../../support/component_harness.dart';

Widget _icons(int n) => Row(
  mainAxisSize: MainAxisSize.min,
  children: <Widget>[
    for (int i = 0; i < n; i++)
      PButton.icon(
        key: ValueKey<String>('icon$i'),
        icon: Icons.add,
        semanticLabel: 'Action $i',
        variant: PButtonVariant.ghost,
        onPressed: () {},
      ),
  ],
);

Future<void> _pump(
  WidgetTester tester,
  Widget bar, {
  double scale = 1,
  TextDirection direction = TextDirection.ltr,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Directionality(
        textDirection: direction,
        child: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(scale)),
          child: Scaffold(
            body: Align(
              alignment: Alignment.topLeft,
              child: SizedBox(width: 360, child: bar),
            ),
          ),
        ),
      ),
    ),
  );
}

Rect _r(WidgetTester tester, Finder f) => tester.getRect(f);

void main() {
  group('PTopBar measured layout', () {
    testWidgets('3 trailing icons never overlap the title at 1.0x', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        PTopBar(title: 'Weekly plan', trailing: _icons(3)),
      );

      final Rect title = _r(tester, find.text('Weekly plan'));
      final Rect trailing = _r(tester, find.byType(Row).last);
      expect(title.right, lessThanOrEqualTo(trailing.left));
      expect(tester.takeException(), isNull);
    });

    testWidgets('3 trailing icons never overlap the title at 2.0x', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        PTopBar(title: 'Weekly plan', trailing: _icons(3)),
        scale: 2,
      );

      final Rect title = _r(tester, find.text('Weekly plan'));
      final Rect trailing = _r(tester, find.byType(Row).last);
      expect(title.right, lessThanOrEqualTo(trailing.left));
      expect(tester.takeException(), isNull);
    });

    testWidgets('back + 2 icons: title clears both sides', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        PTopBar(
          title: 'Shopping list',
          onBack: () {},
          backSemanticLabel: 'Back',
          trailing: _icons(2),
        ),
        scale: 1.5,
      );

      final Rect title = _r(tester, find.text('Shopping list'));
      final Rect back = _r(tester, find.byType(PTopBarBackButton));
      final Rect trailing = _r(tester, find.byType(Row).last);
      expect(title.left, greaterThanOrEqualTo(back.right));
      expect(title.right, lessThanOrEqualTo(trailing.left));
    });

    testWidgets('a long title wraps and stays clear of the trailing slot', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        PTopBar(
          title: 'Copy Wednesday to Thursday?',
          onBack: () {},
          backSemanticLabel: 'Back',
          trailing: _icons(1),
        ),
      );

      final Rect title = _r(tester, find.text('Copy Wednesday to Thursday?'));
      final Rect back = _r(tester, find.byType(PTopBarBackButton));
      final Rect trailing = _r(tester, find.byType(Row).last);
      expect(title.left, greaterThanOrEqualTo(back.right));
      expect(title.right, lessThanOrEqualTo(trailing.left));
      expect(title.height, greaterThan(40), reason: 'wraps to 2+ lines');
    });

    testWidgets('RTL mirrors: back on the right, trailing on the left', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        PTopBar(
          title: 'Weekly plan',
          onBack: () {},
          backSemanticLabel: 'Back',
          trailing: _icons(2),
        ),
        direction: TextDirection.rtl,
      );

      final Rect title = _r(tester, find.text('Weekly plan'));
      final Rect back = _r(tester, find.byType(PTopBarBackButton));
      final Rect trailing = _r(tester, find.byType(Row).last);
      expect(back.center.dx, greaterThan(180));
      expect(trailing.center.dx, lessThan(180));
      expect(title.right, lessThanOrEqualTo(back.left));
      expect(title.left, greaterThanOrEqualTo(trailing.right));
    });

    testWidgets('one short trailing text keeps the title centred', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        PTopBar(
          title: 'Lunch structure',
          onBack: () {},
          backSemanticLabel: 'Back',
          trailing: const Text('2/4'),
        ),
      );

      final Rect title = _r(tester, find.text('Lunch structure'));
      final Rect trailing = _r(tester, find.text('2/4'));
      expect(title.center.dx, closeTo(180, 1));
      expect(title.right, lessThanOrEqualTo(trailing.left));
    });

    testWidgets('falls back to a start-aligned title when space is tight', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        PTopBar(title: 'Weekly plan', trailing: _icons(3)),
      );

      final Rect title = _r(tester, find.text('Weekly plan'));
      // Not centred (180) — pulled to the start edge (16 padding).
      expect(title.left, closeTo(16, 1));
    });
  });
}
