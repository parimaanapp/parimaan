import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
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
///
/// **Leading "bought" checkbox (D6, E2E_MVP_PLAN.md §18.2.6, W12 S6).**
/// A SEPARATE affordance from the swipe gesture above, sitting to the left
/// of the row's name/quantity content — locked over a second swipe
/// direction specifically to avoid "two different swipe gestures mean two
/// different consequential actions" (this class's own swipe-gesture doc
/// already cites `p_button.dart`'s "never rely on gesture-direction-alone
/// semantics" rule; a second, oppositely-coloured swipe on the identical
/// row would repeat that exact mistake). Gated on the identical
/// `menuId != null` condition as the swipe gesture — same row, same
/// "persistent Shopping List screen only" reasoning. Tapping it calls
/// [CurrentShoppingListController.markPurchased] directly, no confirmation
/// sheet: D5 already established `markPurchased` needs no quantity input,
/// which is what makes a bare tap safe here, unlike `haveIt`'s
/// quantity-sheet flow. Shows an immediate optimistic-checked state,
/// reverting on failure with a visible error — mirroring
/// `have_it_quantity_sheet.dart`'s own "honest UI feedback, never a silent
/// no-op" convention. A successful call is never locally hidden by this
/// widget — same "never let the widget remove itself" discipline as the
/// swipe gesture above: the parent list rebuilds from
/// `ShoppingList.toBuy`, which already excludes a just-purchased item.
///
/// **Shared in-flight guard.** [_isProcessing] below guards BOTH triggers
/// on this one row, not just the swipe gesture alone — a checkbox tap and a
/// swipe landing in quick succession on the same row must never both reach
/// the network: whichever happens first wins, the other is a no-op.
class ChecklistItem extends ConsumerStatefulWidget {
  const ChecklistItem({super.key, required this.item, this.menuId});

  final ShoppingListItem item;

  /// Non-null enables the swipe gesture AND the "bought" checkbox — see
  /// this class's own doc.
  final String? menuId;

  static Key rowKey(String itemId) => Key('checklist-item-$itemId');

  /// The leading "bought" checkbox (D6) — present only when [menuId] is
  /// non-null, see this class's own doc.
  static Key checkboxKey(String itemId) =>
      Key('checklist-item-checkbox-$itemId');

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
  ///
  /// **Shared with the "bought" checkbox (D6, W12 S6):** this is the SAME
  /// flag both [_handleSwipe] and [_handleMarkPurchased] check, so a
  /// checkbox tap and a swipe landing on this row in quick succession can
  /// never both reach the network — whichever sets this `true` first wins,
  /// the other trigger's own guard clause returns immediately.
  bool _isProcessing = false;

  /// The checkbox's own optimistic-checked visual state (D6) — set `true`
  /// the instant a tap lands, reverted to `false` on a failed
  /// `markPurchased`. A successful call never reads this again: the row is
  /// removed by the parent's own state rebuild before it would matter (see
  /// this class's own doc for why the checkbox never locally hides itself).
  bool _isOptimisticallyChecked = false;

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

  /// The "bought" checkbox's tap handler (D6). Shares [_isProcessing] with
  /// [_handleSwipe] — see that field's own doc — so this guard clause is
  /// what stops a checkbox tap from firing while a swipe attempt on this
  /// exact row is already in flight, and vice versa (the checkbox's own
  /// `onChanged` is already `null` whenever `_isProcessing` is true, which
  /// makes a swipe-in-flight tap unreachable in practice; this check is
  /// belt-and-suspenders defense-in-depth for the same guard, not the sole
  /// line of defense the way [_handleSwipe]'s identical check is against an
  /// un-disableable `Dismissible`).
  Future<void> _handleMarkPurchased() async {
    if (_isProcessing) return;
    setState(() {
      _isProcessing = true;
      _isOptimisticallyChecked = true;
    });
    final String menuId = widget.menuId!;
    try {
      await ref
          .read(currentShoppingListControllerProvider(menuId).notifier)
          .markPurchased(widget.item.id);
      // Success: the controller's own state rebuild removes this row from
      // the parent list (`ShoppingList.toBuy` no longer includes it) — see
      // this class's own doc for why this widget never hides itself. If
      // this instance somehow survives that rebuild, just clear the guard.
      if (mounted) setState(() => _isProcessing = false);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isProcessing = false;
        _isOptimisticallyChecked = false;
      });
      final String message = error is AppError
          ? error.errorMessage
          : 'Could not mark this item as bought. Please try again.';
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final String? menuId = widget.menuId;
    final Widget row = PCard(
      key: ChecklistItem.rowKey(widget.item.id),
      child: Row(
        children: <Widget>[
          if (menuId != null) ...<Widget>[
            // Labelled explicitly (rather than left to merge with the
            // sibling name `Text` below) so a screen reader announces which
            // item this checkbox marks bought, not just "checkbox".
            Semantics(
              label: 'Mark ${widget.item.name} as bought',
              child: Checkbox(
                key: ChecklistItem.checkboxKey(widget.item.id),
                value: _isOptimisticallyChecked,
                onChanged: _isProcessing
                    ? null
                    : (bool? _) => _handleMarkPurchased(),
              ),
            ),
            const SizedBox(width: AppSpacing.s1),
          ],
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
