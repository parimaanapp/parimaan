import 'package:flutter/material.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/shopping_list_item.dart';

/// The Have-it quantity sheet (wireframe 39/49, E2E_MVP_PLAN.md §17.1/§17.3
/// S7) — D5's locked design (§17.2.5/§17.7): defaults to the shopping-list
/// item's own quantity, pre-filled and editable inline, one confirm action.
/// Cancelling — including dismissing the sheet's own drag handle/barrier —
/// commits nothing and calls [onConfirm] zero times.
///
/// A modal bottom sheet, not a `Dialog` — matches this wireframe's own
/// "sheet" name (§17.1) and `recipe_overflow_menu.dart`'s established
/// bottom-sheet convention for a compact, non-full-screen confirm surface.
///
/// This is the ONLY path in this codebase that calls
/// [ShoppingListItem]-scoped `CurrentShoppingListController.haveIt` — S7's
/// own confirm-gate RED test asserts directly that [ChecklistItem]'s swipe
/// gesture reaches this sheet and never calls `haveIt` itself.
///
/// On a failed [onConfirm], the sheet stays open with the server's message
/// shown inline (never pops) — same "keep the surface open, show what went
/// wrong" convention `delete_recipe_dialog.dart` already uses, so the item
/// behind this sheet stays visible and unmoved on the screen behind it
/// (S7's own "no silent no-op" RED test).
Future<bool> showHaveItQuantitySheet({
  required BuildContext context,
  required ShoppingListItem item,
  required Future<void> Function(double quantity) onConfirm,
}) async {
  final bool? confirmed = await showModalBottomSheet<bool>(
    context: context,
    backgroundColor: AppColors.paper,
    isScrollControlled: true,
    builder: (BuildContext context) =>
        HaveItQuantitySheet(item: item, onConfirm: onConfirm),
  );
  return confirmed ?? false;
}

class HaveItQuantitySheet extends StatefulWidget {
  const HaveItQuantitySheet({
    super.key,
    required this.item,
    required this.onConfirm,
  });

  final ShoppingListItem item;

  /// Called with the confirmed quantity — the caller is what actually wires
  /// this into `CurrentShoppingListController.haveIt`, keeping this widget
  /// provider-free and directly testable, same "callback, not a provider
  /// read" boundary `delete_recipe_dialog.dart`'s own confirm callback uses.
  final Future<void> Function(double quantity) onConfirm;

  static const Key quantityFieldKey = Key('have-it-quantity-field');
  static const Key cancelButtonKey = Key('have-it-quantity-cancel');
  static const Key confirmButtonKey = Key('have-it-quantity-confirm');
  static const Key errorKey = Key('have-it-quantity-error');

  /// D5's default — the shopping-list item's own quantity, with a trailing
  /// `.0` dropped so a whole-number quantity doesn't read oddly in a field
  /// the user is about to edit — same formatting rule
  /// `manual_add_screen.dart`'s own `_formatNumber` and `ChecklistItem`'s
  /// own `_quantityLabel` both already apply. A `null` quantity (never
  /// actually emitted by S1's aggregation for an in-list item, but not
  /// trusted to always be present) falls back to an empty field rather than
  /// a literal `"null"`.
  static String formatDefaultQuantity(double? quantity) {
    if (quantity == null) return '';
    return quantity == quantity.roundToDouble()
        ? quantity.toStringAsFixed(0)
        : quantity.toString();
  }

  @override
  State<HaveItQuantitySheet> createState() => _HaveItQuantitySheetState();
}

class _HaveItQuantitySheetState extends State<HaveItQuantitySheet> {
  late final TextEditingController _quantity = TextEditingController(
    text: HaveItQuantitySheet.formatDefaultQuantity(widget.item.quantity),
  );

  bool _isBusy = false;
  String? _errorMessage;

  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }

  double? get _parsedQuantity {
    final String trimmed = _quantity.text.trim();
    if (trimmed.isEmpty) return null;
    return double.tryParse(trimmed);
  }

  bool get _isValid {
    final double? value = _parsedQuantity;
    return value != null && value > 0;
  }

  Future<void> _confirm() async {
    final double? quantity = _parsedQuantity;
    if (quantity == null || quantity <= 0) return;
    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      await widget.onConfirm(quantity);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isBusy = false;
        _errorMessage = error is AppError
            ? error.errorMessage
            : 'Could not mark this item as had. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final String? unit = widget.item.unit;
    final String label = (unit == null || unit.isEmpty)
        ? 'Quantity'
        : 'Quantity ($unit)';

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: AppSpacing.s3,
          right: AppSpacing.s3,
          top: AppSpacing.s3,
          bottom: AppSpacing.s3 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              'Have it — ${widget.item.name}',
              style: AppTypography.title.copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              'How much did you get? Defaults to what the list called for — '
              'edit it if you bought a different amount.',
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
            const SizedBox(height: AppSpacing.s3),
            PInput(
              key: HaveItQuantitySheet.quantityFieldKey,
              label: label,
              controller: _quantity,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              useMonoFont: true,
              enabled: !_isBusy,
              onChanged: (_) => setState(() {}),
            ),
            if (_errorMessage != null) ...<Widget>[
              const SizedBox(height: AppSpacing.s2),
              Text(
                _errorMessage!,
                key: HaveItQuantitySheet.errorKey,
                style: AppTypography.label.copyWith(color: AppColors.danger),
              ),
            ],
            const SizedBox(height: AppSpacing.s3),
            Row(
              children: <Widget>[
                Expanded(
                  child: PButton(
                    key: HaveItQuantitySheet.cancelButtonKey,
                    label: 'Cancel',
                    variant: PButtonVariant.secondary,
                    onPressed: _isBusy
                        ? null
                        : () => Navigator.of(context).pop(false),
                  ),
                ),
                const SizedBox(width: AppSpacing.s2),
                Expanded(
                  child: PButton(
                    key: HaveItQuantitySheet.confirmButtonKey,
                    label: 'Have it',
                    variant: PButtonVariant.affirmative,
                    isLoading: _isBusy,
                    onPressed: (_isBusy || !_isValid) ? null : _confirm,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
