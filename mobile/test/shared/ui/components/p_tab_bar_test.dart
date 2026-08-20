import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_tab_bar.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

const List<PTabBarItem> _items = <PTabBarItem>[
  PTabBarItem(
    icon: Icons.home_outlined,
    activeIcon: Icons.home,
    label: 'Today',
  ),
  PTabBarItem(icon: Icons.grid_view, label: 'Plan'),
  PTabBarItem(icon: Icons.inventory_2_outlined, label: 'Pantry'),
  PTabBarItem(icon: Icons.checklist, label: 'List'),
];

Widget _bar({int currentIndex = 0, ValueChanged<int>? onSelect}) => PTabBar(
  items: _items,
  currentIndex: currentIndex,
  onSelect: onSelect ?? (_) {},
);

void main() {
  group('PTabBar', () {
    testWidgets('renders every item label', (WidgetTester tester) async {
      await pumpFullWidth(tester, _bar());

      for (final PTabBarItem item in _items) {
        expect(find.text(item.label), findsOneWidget);
      }
    });

    testWidgets('reports the tapped index', (WidgetTester tester) async {
      final List<int> selected = <int>[];
      await pumpFullWidth(tester, _bar(onSelect: selected.add));

      await tester.tap(find.text('Pantry'));
      await tester.pump();

      expect(selected, <int>[2]);
    });

    testWidgets('every tab clears the min touch target', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, _bar());

      final Iterable<Element> tabs = find.byType(PTabBarTab).evaluate();
      expect(tabs.length, _items.length);
      for (int i = 0; i < _items.length; i++) {
        final Size size = tester.getSize(find.byType(PTabBarTab).at(i));
        expect(
          size.height,
          greaterThanOrEqualTo(AppSizing.minTouchTargetHeight),
        );
        expect(size.width, greaterThanOrEqualTo(AppSizing.minTouchTargetWidth));
      }
    });

    testWidgets('the active tab is marked by weight and icon, not colour '
        'alone', (WidgetTester tester) async {
      await pumpFullWidth(tester, _bar(currentIndex: 0));

      final Text active = tester.widget<Text>(find.text('Today'));
      final Text inactive = tester.widget<Text>(find.text('Plan'));

      expect(active.style!.color, AppColors.ink);
      expect(inactive.style!.color, AppColors.inkMid);
      expect(
        active.style!.fontWeight,
        isNot(inactive.style!.fontWeight),
        reason: 'weight must differentiate the active tab independently of hue',
      );
      // Duotone icons are allowed ONLY here — the active tab swaps glyph.
      expect(find.byIcon(Icons.home), findsOneWidget);
      expect(find.byIcon(Icons.home_outlined), findsNothing);
    });

    testWidgets('falls back to the single icon when no active glyph is given', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(tester, _bar(currentIndex: 1));

      expect(find.byIcon(Icons.grid_view), findsOneWidget);
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

    testWidgets('renders icons at the nav size', (WidgetTester tester) async {
      await pumpFullWidth(tester, _bar());

      expect(
        tester.widget<Icon>(find.byIcon(Icons.grid_view)).size,
        AppSizing.icon24,
      );
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
            PTabBarItem(icon: Icons.home, label: 'Today'),
          ],
          currentIndex: 0,
          onSelect: (_) {},
        ),
        throwsAssertionError,
      );
    });
  });
}
