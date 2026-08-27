import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/ui/components/p_tab_bar.dart';

/// The signed-in app's persistent chrome: an [IndexedStack]-backed bottom
/// tab bar over the [StatefulShellRoute] branches in `router.dart`.
///
/// Three tabs — Plan (W9) and List (W11) are later weeks' work, not missing
/// pieces of this one. Each addition is its own slice, not a growth of this
/// file.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  static const List<PTabBarItem> _items = <PTabBarItem>[
    PTabBarItem(
      icon: Icons.home_outlined,
      activeIcon: Icons.home,
      label: 'Home',
    ),
    PTabBarItem(
      icon: Icons.inventory_2_outlined,
      activeIcon: Icons.inventory_2,
      label: 'Pantry',
    ),
    PTabBarItem(
      icon: Icons.menu_book_outlined,
      activeIcon: Icons.menu_book,
      label: 'Recipes',
    ),
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
    body: navigationShell,
    bottomNavigationBar: PTabBar(
      items: _items,
      currentIndex: navigationShell.currentIndex,
      // `initialLocation: true` when re-tapping the already-active branch
      // resets it to its own initial route — go_router's own recommended
      // pattern for a bottom-tab shell, and the reason `goBranch` is used
      // here rather than a plain `context.go`.
      onSelect: (int index) => navigationShell.goBranch(
        index,
        initialLocation: index == navigationShell.currentIndex,
      ),
    ),
  );
}
