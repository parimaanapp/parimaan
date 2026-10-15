import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_tab_bar.dart';
import 'package:mobile/shared/ui/components/p_tab_glyph.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

const List<PTabBarItem> _items = <PTabBarItem>[
  PTabBarItem(glyph: PTabGlyph.today, label: 'Today'),
  PTabBarItem(glyph: PTabGlyph.plan, label: 'Plan'),
  PTabBarItem(glyph: PTabGlyph.pantry, label: 'Pantry'),
  PTabBarItem(glyph: PTabGlyph.recipes, label: 'Recipes'),
];

Widget _bar({int currentIndex = 0, ValueChanged<int>? onSelect}) => PTabBar(
  items: _items,
  currentIndex: currentIndex,
  onSelect: onSelect ?? (_) {},
);

PTabGlyphIcon _glyphIcon(WidgetTester tester, int index) =>
    tester.widget<PTabGlyphIcon>(find.byType(PTabGlyphIcon).at(index));

void main() {
  group('PTabBar', () {
    testWidgets('renders every item label, in order', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, _bar());

      final List<String> labels = find
          .descendant(
            of: find.byType(PTabBarTab),
            matching: find.byType(Text),
          )
          .evaluate()
          .map((Element e) => (e.widget as Text).data!)
          .toList();
      expect(labels, <String>['Today', 'Plan', 'Pantry', 'Recipes']);
    });

    testWidgets('draws its own glyphs, no stock Material icons', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, _bar());

      expect(find.byType(Icon), findsNothing);
      expect(find.byType(PTabGlyphIcon), findsNWidgets(_items.length));
      for (int i = 0; i < _items.length; i++) {
        expect(_glyphIcon(tester, i).glyph, _items[i].glyph);
        expect(_glyphIcon(tester, i).size, AppSizing.icon20);
      }
    });

    testWidgets('reports the tapped index', (WidgetTester tester) async {
      final List<int> selected = <int>[];
      await pumpFullWidth(tester, _bar(onSelect: selected.add));

      await tester.tap(find.text('Pantry'));
      await tester.pump();

      expect(selected, <int>[2]);
    });

    testWidgets('the bar is the scaled 48 high and every tab clears the '
        'touch target', (WidgetTester tester) async {
      await pumpFullWidth(tester, _bar());

      expect(
        tester.getSize(find.byType(PTabBarTab).first).height,
        greaterThanOrEqualTo(AppSizing.tabBarHeight),
      );
      for (int i = 0; i < _items.length; i++) {
        final Size size = tester.getSize(find.byType(PTabBarTab).at(i));
        expect(
          size.height,
          greaterThanOrEqualTo(AppSizing.minTouchTargetHeight),
        );
        expect(size.width, greaterThanOrEqualTo(AppSizing.minTouchTargetWidth));
      }
    });

    testWidgets('active is ink and semibold, inactive is inkMid and regular', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, _bar(currentIndex: 0));

      final Text active = tester.widget<Text>(find.text('Today'));
      final Text inactive = tester.widget<Text>(find.text('Plan'));

      expect(active.style!.color, AppColors.ink);
      expect(active.style!.fontWeight, FontWeight.w600);
      expect(inactive.style!.color, AppColors.inkSoft);
      expect(inactive.style!.fontWeight, FontWeight.w400);
      expect(_glyphIcon(tester, 0).color, AppColors.ink);
      expect(_glyphIcon(tester, 1).color, AppColors.inkMid);
    });

    testWidgets('exposes selection to screen readers', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, _bar(currentIndex: 2));

      await withSemantics(tester, () async {
        expect(
          tester.getSemantics(find.byType(PTabBarTab).at(2)),
          isSemantics(label: 'Pantry', isSelected: true, isButton: true),
        );
      });
    });

    testWidgets('rejects an out-of-range index', (WidgetTester tester) async {
      expect(
        () => PTabBar(items: _items, currentIndex: 9, onSelect: (_) {}),
        throwsAssertionError,
      );
    });

    testWidgets('rejects fewer than two tabs', (WidgetTester tester) async {
      expect(
        () => PTabBar(
          items: const <PTabBarItem>[
            PTabBarItem(glyph: PTabGlyph.today, label: 'Today'),
          ],
          currentIndex: 0,
          onSelect: (_) {},
        ),
        throwsAssertionError,
      );
    });
  });
}
