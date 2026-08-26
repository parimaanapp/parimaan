import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/pantry_item.dart';
import '../state/pantry_form_controller.dart';
import 'pantry_error_copy.dart';

/// A row action → confirm dialog, precedent
/// `delete_household_dialog.dart` — with no typed-name confirmation, unlike
/// that one: a pantry item is a low-stakes, single-user-scoped delete (not
/// irreversible for a whole household's membership), so a plain Yes/No is
/// proportionate. Returns `true` only if the item was actually deleted.
Future<bool> showDeletePantryItemDialog({
  required BuildContext context,
  required PantryItem item,
}) async {
  final bool? deleted = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => DeletePantryItemDialog(item: item),
  );
  return deleted ?? false;
}

class DeletePantryItemDialog extends ConsumerWidget {
  const DeletePantryItemDialog({super.key, required this.item});

  final PantryItem item;

  static const Key cancelButtonKey = Key('delete-pantry-item-cancel');
  static const Key confirmButtonKey = Key('delete-pantry-item-confirm');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> formState = ref.watch(pantryFormControllerProvider);
    final bool isBusy =
        formState.isLoading &&
        ref.read(pantryFormControllerProvider.notifier).action ==
            PantryFormAction.delete;
    final String? errorMessage = pantryErrorMessage(formState.error);

    Future<void> confirm() async {
      final bool ok = await ref
          .read(pantryFormControllerProvider.notifier)
          .delete(item.id);
      if (context.mounted && ok) {
        Navigator.of(context).pop(true);
      }
      // A failure keeps the dialog open with the server's message visible —
      // the item still exists, and dismissing would imply otherwise.
    }

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
              'Delete this item?',
              style: AppTypography.title.copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              '"${item.name}" will be removed from the pantry.',
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
            if (errorMessage != null) ...<Widget>[
              const SizedBox(height: AppSpacing.s2),
              Text(
                errorMessage,
                style: AppTypography.label.copyWith(color: AppColors.danger),
              ),
            ],
            const SizedBox(height: AppSpacing.s3),
            Row(
              children: <Widget>[
                Expanded(
                  child: PButton(
                    key: cancelButtonKey,
                    label: 'Cancel',
                    variant: PButtonVariant.secondary,
                    onPressed: isBusy
                        ? null
                        : () => Navigator.of(context).pop(false),
                  ),
                ),
                const SizedBox(width: AppSpacing.s2),
                Expanded(
                  child: PButton(
                    key: confirmButtonKey,
                    label: 'Delete',
                    variant: PButtonVariant.destructive,
                    isLoading: isBusy,
                    onPressed: isBusy ? null : confirm,
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
