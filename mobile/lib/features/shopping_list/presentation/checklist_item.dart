import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/shopping_list_category_order.dart';
import '../domain/shopping_list_item.dart';
import '../../../shared/format/quantity_format.dart';
import '../state/current_shopping_list_controller.dart';
import 'checklist_check_box.dart';
import 'have_it_quantity_sheet.dart';

export 'checklist_check_box.dart';

/// One row on the List preview / Shopping List screens (§4's own named
/// deliverable, "a `ChecklistItem` widget", E2E_MVP_PLAN.md §17.1/§17.3 S6).
///
/// Renders [item]'s name, quantity/unit, and (unlike the categorized-group
/// header this widget's own callers render above it) does NOT repeat the
/// category on the row itself — the grouping IS the category display, same
/// as `pantry_list_screen.dart`'s own category-chip-filtered rows never
/// repeating the active filter's name on every row.
///
/// **Swipes (wireframe 10.2).** Enabled only when [menuId] is non-null —
/// the persistent Shopping List screen's own usage; the List preview passes
/// no [menuId] and renders a plain, non-swipeable row. Swipe LEFT
/// (`endToStart`) is "Have it": it opens [showHaveItQuantitySheet] and never
/// calls `CurrentShoppingListController.haveIt` directly (S7's confirm
/// gate). Swipe RIGHT (`startToEnd`) marks the item bought. (Before C2 the
/// right swipe was Have it; the directions were reversed to match the
/// approved wireframe.) `Dismissible.confirmDismiss` always returns `false`:
/// a successful call drops the item out of `ShoppingList.toBuy`, which
/// removes the row through the parent's rebuild — letting `Dismissible` also
/// remove it would race that rebuild, and a cancelled or failed attempt
/// leaves the row exactly where it was.
///
/// **Check box (D6, E2E_MVP_PLAN.md §18.2.6).** A tap target to the left of
/// the name that calls [CurrentShoppingListController.markPurchased], the
/// same action as swipe right, with no confirmation (D5: `markPurchased`
/// needs no quantity). It shows an optimistic done state (green fill,
/// strike-through) and reverts with a visible error on failure. The row is
/// never hidden locally; the parent list's rebuild removes it. Because the
/// optimistic flag lives in this State, rows are keyed by item id wherever
/// they are listed, so it cannot be inherited by a neighbouring row.
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
        : formatQuantity(quantity);
    if (unit == null) return quantityPart;
    return quantityPart.isEmpty ? unit : '$quantityPart $unit';
  }

  /// Swipe left (`endToStart`) = Have it, which opens the quantity sheet;
  /// swipe right (`startToEnd`) = mark bought (wireframe 10.2). Both return
  /// `false` so `Dismissible` never removes the row itself — see this
  /// class's own doc.
  Future<bool> _handleSwipe(DismissDirection direction) async {
    if (direction == DismissDirection.startToEnd) {
      await _handleMarkPurchased();
      return false;
    }
    return _handleHaveIt();
  }

  Future<bool> _handleHaveIt() async {
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
      if (mounted) {
        setState(() {
          _isProcessing = false;
          // If this instance survives the parent's rebuild, do not leave a
          // stale done state behind.
          _isOptimisticallyChecked = false;
        });
      }
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
    final bool isDone = widget.item.purchased || _isOptimisticallyChecked;
    final String quantity = _quantityLabel(widget.item);
    final Widget row = PCard(
      key: ChecklistItem.rowKey(widget.item.id),
      padding: EdgeInsets.only(
        left: menuId != null ? 0 : AppSpacing.s2,
        right: AppSpacing.s2,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: AppSizing.minTouchTargetHeight,
        ),
        child: Row(
          children: <Widget>[
            if (menuId != null)
              ChecklistCheckBox(
                key: ChecklistItem.checkboxKey(widget.item.id),
                itemId: widget.item.id,
                isChecked: isDone,
                semanticLabel: 'Mark ${widget.item.name} as bought',
                onChanged: _isProcessing ? null : _handleMarkPurchased,
              ),
            Flexible(
              flex: 3,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.s1),
                child: Text(
                  widget.item.name,
                  style: AppTypography.body.copyWith(
                    color: isDone ? AppColors.inkMid : AppColors.ink,
                    decoration: isDone ? TextDecoration.lineThrough : null,
                  ),
                ),
              ),
            ),
            if (quantity.isNotEmpty) ...<Widget>[
              const SizedBox(width: AppSpacing.s1),
              // Never truncated: quantity and unit wrap rather than
              // ellipsize, so "0.33 cup" can never read as "0.33 c…".
              Flexible(
                flex: 2,
                child: Text(
                  quantity,
                  textAlign: TextAlign.end,
                  style: AppTypography.mono.copyWith(
                    color: AppColors.inkMid,
                    decoration: isDone ? TextDecoration.lineThrough : null,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );

    if (menuId == null) return row;

    return Dismissible(
      key: ValueKey<String>('checklist-item-dismissible-${widget.item.id}'),
      direction: DismissDirection.horizontal,
      confirmDismiss: _handleSwipe,
      background: const _SwipeBackground(
        label: 'Bought',
        alignment: AlignmentDirectional.centerStart,
        color: AppColors.cardamomSoft,
        foreground: AppColors.cardamomSoftForeground,
      ),
      secondaryBackground: const _SwipeBackground(
        label: 'Have it',
        alignment: AlignmentDirectional.centerEnd,
        color: AppColors.cardamom,
        foreground: AppColors.card,
      ),
      child: Semantics(
        customSemanticsActions: <CustomSemanticsAction, VoidCallback>{
          const CustomSemanticsAction(label: 'Have it'): _handleHaveIt,
          const CustomSemanticsAction(label: 'Mark bought'):
              _handleMarkPurchased,
        },
        child: row,
      ),
    );
  }
}

/// The reveal behind a [ChecklistItem] row mid-swipe. Colour never carries
/// the meaning alone: the label and tick say it in words (wireframe 10.2).
class _SwipeBackground extends StatelessWidget {
  const _SwipeBackground({
    required this.label,
    required this.alignment,
    required this.color,
    required this.foreground,
  });

  final String label;
  final AlignmentGeometry alignment;
  final Color color;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
    alignment: alignment,
    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
    decoration: BoxDecoration(color: color, borderRadius: AppRadius.borderL),
    child: Text(
      '✓ $label',
      style: AppTypography.label.copyWith(
        color: foreground,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

/// [groupShoppingListItemsByCategory]'s own output, rendered as one section
/// per category — a stable-order category heading, followed by a
/// [ChecklistItem] per item in that group. Shared between `ListPreviewScreen`
/// and `ShoppingListScreen` so the grouping logic and the section layout
/// never drift between the two screens that both render it.
class CategorizedChecklist extends StatelessWidget {
  const CategorizedChecklist({
    super.key,
    required this.items,
    this.menuId,
    this.header,
    this.footer,
  });

  final List<ShoppingListItem> items;

  /// Threaded straight through to every [ChecklistItem] row — see that
  /// widget's own doc for what a non-null value enables.
  final String? menuId;

  /// Widgets rendered before the first section, inside the same scroll view.
  final List<Widget>? header;

  /// Widgets rendered after the last section inside the same scroll view
  /// (the screen's Staples check card).
  final List<Widget>? footer;

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
        ...?header,
        for (final ShoppingListCategoryGroup group in groups)
          Padding(
            key: ValueKey<String>('checklist-group-${group.category}'),
            padding: const EdgeInsets.only(bottom: AppSpacing.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _SectionLabel(
                  key: CategorizedChecklist.categoryHeadingKey(group.category),
                  label: shoppingListCategoryLabel(group.category),
                ),
                for (final ShoppingListItem item in group.items)
                  Padding(
                    key: ValueKey<String>('checklist-pad-${item.id}'),
                    padding: const EdgeInsets.only(bottom: AppSpacing.s1),
                    child: ChecklistItem(
                      key: ValueKey<String>('checklist-${item.id}'),
                      item: item,
                      menuId: menuId,
                    ),
                  ),
              ],
            ),
          ),
        ...?footer,
      ],
    );
  }
}

/// Mono-caps section label (wireframe `S.label`).
class _SectionLabel extends StatelessWidget {
  const _SectionLabel({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    label: label,
    excludeSemantics: true,
    child: Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s1),
      child: Text(
        label.toUpperCase(),
        style: AppTypography.meta.copyWith(
          fontFamily: AppFontFamily.mono,
          color: AppColors.inkMid,
        ),
      ),
    ),
  );
}
