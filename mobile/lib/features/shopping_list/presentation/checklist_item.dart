import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/shopping_list_category_order.dart';
import '../domain/shopping_list_item.dart';

/// One row on the List preview / Shopping List screens (§4's own named
/// deliverable, "a `ChecklistItem` widget", E2E_MVP_PLAN.md §17.1/§17.3 S6).
///
/// Renders [item]'s name, quantity/unit, and (unlike the categorized-group
/// header this widget's own callers render above it) does NOT repeat the
/// category on the row itself — the grouping IS the category display, same
/// as `pantry_list_screen.dart`'s own category-chip-filtered rows never
/// repeating the active filter's name on every row.
///
/// The swipe-to-"Have it" gesture (S7, wireframe 38/49) is deliberately NOT
/// built here — S6's own RED-test list has no swipe test, and S7's plan
/// entry names `checklist_item.dart` as a file IT touches to add that
/// affordance. Building a half-finished gesture now would be exactly the
/// kind of undocumented scope creep this codebase's own review passes flag.
class ChecklistItem extends StatelessWidget {
  const ChecklistItem({super.key, required this.item});

  final ShoppingListItem item;

  static Key rowKey(String itemId) => Key('checklist-item-$itemId');

  /// `"2 kg"`, `"3"` (no unit), or `""` (neither present) — never a
  /// dangling `"null null"` for an item whose free-text quantity/unit came
  /// back empty from the server (S1's aggregation never emits a fully-null
  /// pair for an in-list item, but a defensive display format costs nothing
  /// and matches this codebase's own "never trust a nullable field to
  /// always be present" posture).
  static String _quantityLabel(ShoppingListItem item) {
    final double? quantity = item.quantity;
    final String? unit = item.unit;
    if (quantity == null && unit == null) return '';
    final String quantityPart = quantity == null
        ? ''
        : (quantity == quantity.roundToDouble()
              ? quantity.toStringAsFixed(0)
              : quantity.toString());
    if (unit == null) return quantityPart;
    return quantityPart.isEmpty ? unit : '$quantityPart $unit';
  }

  @override
  Widget build(BuildContext context) => PCard(
    key: ChecklistItem.rowKey(item.id),
    child: Row(
      children: <Widget>[
        Expanded(
          child: Text(
            item.name,
            style: AppTypography.body,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: AppSpacing.s2),
        Text(
          _quantityLabel(item),
          style: AppTypography.meta.copyWith(color: AppColors.inkMid),
        ),
      ],
    ),
  );
}

/// [groupShoppingListItemsByCategory]'s own output, rendered as one section
/// per category — a stable-order category heading, followed by a
/// [ChecklistItem] per item in that group. Shared between `ListPreviewScreen`
/// and `ShoppingListScreen` so the grouping logic and the section layout
/// never drift between the two screens that both render it.
class CategorizedChecklist extends StatelessWidget {
  const CategorizedChecklist({super.key, required this.items});

  final List<ShoppingListItem> items;

  static const String categoryHeadingKeyPrefix = 'checklist-category-';
  static Key categoryHeadingKey(String category) =>
      Key('$categoryHeadingKeyPrefix$category');

  @override
  Widget build(BuildContext context) {
    final List<ShoppingListCategoryGroup> groups =
        groupShoppingListItemsByCategory(items);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.s3),
      children: <Widget>[
        for (final ShoppingListCategoryGroup group in groups)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  shoppingListCategoryLabel(group.category),
                  key: CategorizedChecklist.categoryHeadingKey(group.category),
                  style: AppTypography.title,
                ),
                const SizedBox(height: AppSpacing.s2),
                for (final ShoppingListItem item in group.items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.s2),
                    child: ChecklistItem(item: item),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
