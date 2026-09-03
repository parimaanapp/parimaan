import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// The confirm gate the shopping-list "Regenerate" affordance shows whenever
/// committing `regenerateShoppingList(confirmed: true)` would replace an
/// existing not-yet-bought item — D8's merge-regenerate design
/// (E2E_MVP_PLAN.md §17.2.8/§17.7): every already-had item is preserved
/// untouched, only the remaining not-yet-had portion is recomputed. Skipped
/// entirely when the visible list has nothing left to buy — there is
/// nothing to lose, so nothing to confirm — same "skip the dialog when there
/// is nothing at stake" rule `RegenerateConfirmDialog` (W10 auto-fill's own
/// equivalent) already applies for menu items.
///
/// Returns `true` only if the user affirmatively tapped "Replace". Cancel —
/// and dismissing the barrier — both resolve to `false` and call nothing,
/// same `showDialog<bool>() ?? false` shape as `showRegenerateConfirmDialog`.
Future<bool> showShoppingListRegenerateConfirmDialog({
  required BuildContext context,
  required int notYetBoughtCount,
}) async {
  final bool? confirmed = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => ShoppingListRegenerateConfirmDialog(
      notYetBoughtCount: notYetBoughtCount,
    ),
  );
  return confirmed ?? false;
}

class ShoppingListRegenerateConfirmDialog extends StatelessWidget {
  const ShoppingListRegenerateConfirmDialog({
    super.key,
    required this.notYetBoughtCount,
  });

  final int notYetBoughtCount;

  static const Key cancelButtonKey = Key(
    'shopping-list-regenerate-confirm-cancel',
  );
  static const Key confirmButtonKey = Key(
    'shopping-list-regenerate-confirm-confirm',
  );

  @override
  Widget build(BuildContext context) {
    final String itemWord = notYetBoughtCount == 1 ? 'item' : 'items';
    return Dialog(
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.borderL),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s3),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              'Replace $notYetBoughtCount $itemWord still on your list?',
              style: AppTypography.title.copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              'Regenerating recomputes your shopping list from this week\'s '
              'menu and current pantry. Items you\'ve already checked off '
              'are always kept — only what\'s still left to buy is '
              'replaced.',
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
            const SizedBox(height: AppSpacing.s3),
            Row(
              children: <Widget>[
                Expanded(
                  child: PButton(
                    key: cancelButtonKey,
                    label: 'Cancel',
                    variant: PButtonVariant.secondary,
                    onPressed: () => Navigator.of(context).pop(false),
                  ),
                ),
                const SizedBox(width: AppSpacing.s2),
                Expanded(
                  child: PButton(
                    key: confirmButtonKey,
                    label: 'Replace',
                    variant: PButtonVariant.destructive,
                    onPressed: () => Navigator.of(context).pop(true),
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
