import 'package:flutter/material.dart';

import '../tokens.dart';
import 'p_tab_glyph.dart';

/// One destination in a [PTabBar].
///
/// The bar knows nothing about Today / Plan / Pantry / Recipes routes — the
/// glyph and the copy are the caller's, which keeps the app's route names out
/// of the design system.
@immutable
class PTabBarItem {
  const PTabBarItem({required this.glyph, required this.label});

  /// Drawn glyph (shared design-system set, no stock icon font).
  final PTabGlyph glyph;

  /// Visible destination label. Supplied by the caller.
  final String label;
}

/// The bottom navigation bar from the design source's *Mobile app shell*.
///
/// Selection is communicated by ink colour and label weight (semibold vs
/// regular), plus `Semantics.selected` for screen readers.
class PTabBar extends StatelessWidget {
  const PTabBar({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onSelect,
  }) : assert(items.length >= 2, 'A tab bar with one destination is a label'),
       assert(
         currentIndex >= 0 && currentIndex < items.length,
         'currentIndex is out of range for the supplied items',
       );

  final List<PTabBarItem> items;
  final int currentIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) => Container(
    decoration: const BoxDecoration(
      color: AppColors.card,
      // e0: the bar is separated from the page by a hairline, not a shadow.
      border: Border(top: BorderSide(color: AppColors.paper2)),
    ),
    child: SafeArea(
      top: false,
      child: Row(
        children: <Widget>[
          for (int i = 0; i < items.length; i++)
            Expanded(
              child: PTabBarTab(
                item: items[i],
                isSelected: i == currentIndex,
                onTap: () => onSelect(i),
              ),
            ),
        ],
      ),
    ),
  );
}

/// A single tab. Public so callers and tests can reason about one destination;
/// only ever built by [PTabBar].
class PTabBarTab extends StatelessWidget {
  const PTabBarTab({
    super.key,
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  final PTabBarItem item;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color tint = isSelected ? AppColors.ink : AppColors.inkMid;

    return Semantics(
      button: true,
      selected: isSelected,
      label: item.label,
      child: ExcludeSemantics(
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: AppSizing.tabBarHeight,
                minWidth: AppSizing.minTouchTargetWidth,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  vertical: AppSpacing.s1,
                  horizontal: AppSpacing.s0,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    PTabGlyphIcon(glyph: item.glyph, color: tint),
                    const SizedBox(height: AppSpacing.s0),
                    Text(
                      item.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.label.copyWith(
                        color: tint,
                        // Weight, not just hue, marks the active destination.
                        fontWeight: isSelected
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
