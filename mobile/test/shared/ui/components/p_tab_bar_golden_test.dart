import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_tab_bar.dart';

import '../../../support/golden_harness.dart';

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

void main() {
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
