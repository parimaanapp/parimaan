import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_tab_glyph.dart';
import 'package:mobile/shared/ui/components/p_tab_bar.dart';

import '../../../support/golden_harness.dart';
import '../../../support/tolerant_golden_comparator.dart';

const List<PTabBarItem> _items = <PTabBarItem>[
  PTabBarItem(glyph: PTabGlyph.today, label: 'Today'),
  PTabBarItem(glyph: PTabGlyph.plan, label: 'Plan'),
  PTabBarItem(glyph: PTabGlyph.pantry, label: 'Pantry'),
  PTabBarItem(glyph: PTabGlyph.recipes, label: 'Recipes'),
];

void main() {
  // The drawn glyphs are paths; CI anti-aliasing differs by a few pixels.
  useTolerantGoldenComparator();

  goldenTest(
    'PTabBar renders each destination as the active one',
    fileName: 'p_tab_bar',
    builder: () => GoldenTestGroup(
      columns: 1,
      scenarioConstraints: const BoxConstraints(maxWidth: 320),
      children: <Widget>[
        for (int i = 0; i < _items.length; i++)
          scenario(
            name: 'active: ${_items[i].label}',
            child: PTabBar(items: _items, currentIndex: i, onSelect: (_) {}),
          ),
      ],
    ),
  );
}
