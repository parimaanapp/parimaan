import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/shopping_list_category_order.dart';
import '../domain/shopping_list_item.dart';

/// The exact category grouping the share-image render uses — literally
/// [groupShoppingListItemsByCategory], the SAME function
/// `CategorizedChecklist` (the live Shopping List screen,
/// `checklist_item.dart`) calls on the same `toBuy` items. This is a
/// one-line delegation, not a second implementation, precisely so the two
/// can never drift apart — the W17 S4 RED test for this file asserts this
/// function's output against `groupShoppingListItemsByCategory` called
/// directly and expects them identical, by construction.
List<ShoppingListCategoryGroup> shareImageCategoryGroups(ShoppingList list) =>
    groupShoppingListItemsByCategory(list.toBuy);

/// The categorized shopping-list PNG content (W17 S4, E2E_MVP_PLAN.md
/// §23.2.8 D8) — the "Share image preview" wireframe screen's own body
/// (44/50). Deliberately NOT the interactive checklist screen re-rendered:
/// no checkboxes, no swipe affordances, no per-item tap targets — a static,
/// clean summary meant to be read as a photo/screenshot substitute in
/// WhatsApp/Swiggy/Blinkit, not interacted with.
///
/// A caller wraps this in a `RepaintBoundary` (done by
/// `ShoppingListShareImageScreen`, not here) — this widget itself is a
/// plain, boundary-free subtree so it can also be pumped directly in a
/// widget test without needing a real rasterization pass.
class ShoppingListShareImageContent extends StatelessWidget {
  const ShoppingListShareImageContent({
    super.key,
    required this.list,
    required this.generatedAt,
  });

  final ShoppingList list;

  /// The client-side capture time, shown under the title — this is a
  /// render-time stamp, not [ShoppingList.createdAt] (which is when the
  /// list itself was generated, possibly days earlier).
  final DateTime generatedAt;

  static const Key rootKey = Key('shopping-list-share-image-content');

  @override
  Widget build(BuildContext context) {
    final List<ShoppingListCategoryGroup> groups = shareImageCategoryGroups(
      list,
    );

    return ColoredBox(
      key: rootKey,
      color: AppColors.paper,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text('Shopping list', style: AppTypography.displayM),
            const SizedBox(height: AppSpacing.s0),
            Text(_formatDate(generatedAt), style: AppTypography.meta),
            const SizedBox(height: AppSpacing.s4),
            if (groups.isEmpty)
              Text(
                'Nothing left to buy — every item has been checked off.',
                style: AppTypography.body.copyWith(color: AppColors.inkSoft),
              )
            else
              for (final ShoppingListCategoryGroup group in groups)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.s3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        shoppingListCategoryLabel(group.category),
                        key: ShoppingListShareImageContent.categoryHeadingKey(
                          group.category,
                        ),
                        style: AppTypography.title,
                      ),
                      const SizedBox(height: AppSpacing.s1),
                      for (final ShoppingListItem item in group.items)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: AppSpacing.s0,
                          ),
                          child: Text(_itemLine(item), style: AppTypography.body),
                        ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }

  static const String categoryHeadingKeyPrefix =
      'shopping-list-share-image-category-';
  static Key categoryHeadingKey(String category) =>
      Key('$categoryHeadingKeyPrefix$category');

  static String _itemLine(ShoppingListItem item) {
    final String? quantity = item.quantity == null
        ? null
        : _formatQuantity(item.quantity!);
    final String? unit = item.unit;
    final String amount = <String?>[
      quantity,
      unit,
    ].whereType<String>().join(' ');
    return amount.isEmpty ? item.name : '${item.name} — $amount';
  }

  static String _formatQuantity(double quantity) {
    if (quantity == quantity.roundToDouble()) {
      return quantity.toStringAsFixed(0);
    }
    return quantity.toString();
  }

  static String _formatDate(DateTime date) {
    const List<String> months = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }
}
