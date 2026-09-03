import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/shopping_list_category_order.dart';
import '../domain/shopping_list_item.dart';
import '../state/current_shopping_list_controller.dart';
import 'have_it_quantity_sheet.dart';

/// One row on the List preview / Shopping List screens (§4's own named
/// deliverable, "a `ChecklistItem` widget", E2E_MVP_PLAN.md §17.1/§17.3 S6).
///
/// Renders [item]'s name, quantity/unit, and (unlike the categorized-group
/// header this widget's own callers render above it) does NOT repeat the
/// category on the row itself — the grouping IS the category display, same
/// as `pantry_list_screen.dart`'s own category-chip-filtered rows never
/// repeating the active filter's name on every row.
///
/// **Swipe-to-"Have it" (S7, wireframe 38/49).** Enabled only when [menuId]
/// is non-null — the persistent Shopping List screen's own usage. The List
/// preview screen (`list_preview_screen.dart`) passes no [menuId] and
/// renders a plain, non-swipeable row: a freshly generated preview is not
/// the same "act on it now" surface the persistent list is, and S6's own
/// RED-test list never exercised a swipe there. Swiping [PCard.padding]'s
/// own doc-mandated direction ("do not nest links or buttons inside a
/// tappable card; use swipe actions") calls up
/// [showHaveItQuantitySheet] — it never calls
/// `CurrentShoppingListController.haveIt` directly (S7's own confirm-gate
/// RED test). `Dismissible.confirmDismiss` always returns `false` here,
/// deliberately: a successful `haveIt` already drops this item out of
/// `ShoppingList.toBuy`, which removes this row by rebuilding the parent
/// list from controller state — letting `Dismissible` ALSO remove the row
/// itself would race that rebuild. Returning `false` unconditionally means
/// a cancelled or failed attempt leaves the row exactly where it was, and a
/// successful one is removed exactly once, by the state rebuild alone.
class ChecklistItem extends ConsumerStatefulWidget {
  const ChecklistItem({super.key, required this.item, this.menuId});

  final ShoppingListItem item;

  /// Non-null enables the swipe gesture — see this class's own doc.
  final String? menuId;

  static Key rowKey(String itemId) => Key('checklist-item-$itemId');

  @override
  ConsumerState<ChecklistItem> createState() => _ChecklistItemState();
}

class _ChecklistItemState extends ConsumerState<ChecklistItem> {
  /// Guards a swipe from opening a second Have-it sheet — or firing a
  /// second `haveIt` call — while one is already in flight for this exact
  /// row (S7's own double-tap/in-flight-guard RED test). Set for the WHOLE
  /// attempt, gesture to resolution, same "disable the trigger for the
  /// entire attempt, not just the network call" discipline
  /// `ShoppingListScreen._isBusy` already applies to Regenerate (W10
  /// S5/S11 S6b precedent).
  bool _isProcessing = false;

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

  Future<bool> _handleSwipe(DismissDirection direction) async {
    if (_isProcessing) return false;
    setState(() => _isProcessing = true);
    final String menuId = widget.menuId!;
    await showHaveItQuantitySheet(
      context: context,
      item: widget.item,
      onConfirm: (double quantity) => ref
          .read(currentShoppingListControllerProvider(menuId).notifier)
          .haveIt(widget.item.id, quantity),
    );
    if (mounted) setState(() => _isProcessing = false);
    // Never let `Dismissible` itself remove the row — see this file's own
    // class doc for why.
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final Widget row = PCard(
      key: ChecklistItem.rowKey(widget.item.id),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              widget.item.name,
              style: AppTypography.body,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppSpacing.s2),
          Text(
            _quantityLabel(widget.item),
            style: AppTypography.meta.copyWith(color: AppColors.inkMid),
          ),
        ],
      ),
    );

    final String? menuId = widget.menuId;
    if (menuId == null) return row;

    return Dismissible(
      key: ValueKey<String>('checklist-item-dismissible-${widget.item.id}'),
      direction: DismissDirection.startToEnd,
      confirmDismiss: _handleSwipe,
      background: const _HaveItSwipeBackground(),
      child: row,
    );
  }
}

/// The affirmative-coloured reveal behind a [ChecklistItem] row mid-swipe —
/// [AppColors.cardamom]/[AppColors.success] are this design system's own
/// named "Have-it, bought" colour (`colors.dart`'s own doc on both tokens).
/// Colour never carries the meaning alone (this codebase's own
/// accessibility rule, `p_button.dart`'s doc states it for buttons, applied
/// here too): the label and icon say "Have it" in words.
class _HaveItSwipeBackground extends StatelessWidget {
  const _HaveItSwipeBackground();

  @override
  Widget build(BuildContext context) => Container(
    alignment: Alignment.centerLeft,
    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
    decoration: BoxDecoration(
      color: AppColors.cardamom,
      borderRadius: BorderRadius.circular(12),
    ),
    child: const Row(
      children: <Widget>[
        Icon(Icons.check_circle, color: AppColors.card),
        SizedBox(width: AppSpacing.s1),
        Text(
          'Have it',
          style: TextStyle(color: AppColors.card, fontWeight: FontWeight.w600),
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
  const CategorizedChecklist({super.key, required this.items, this.menuId});

  final List<ShoppingListItem> items;

  /// Threaded straight through to every [ChecklistItem] row — see that
  /// widget's own doc for what a non-null value enables.
  final String? menuId;

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
                    child: ChecklistItem(item: item, menuId: menuId),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
