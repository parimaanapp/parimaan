import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/recipe.dart';
import '../state/recipe_detail_controller.dart';
import '../state/recipe_overflow_controller.dart';
import 'recipes_error_copy.dart';

/// A row action → confirm dialog, precedent `delete_pantry_item_dialog.dart`
/// — plain Yes/No, no typed-name confirmation (a recipe delete is not the
/// irreversible whole-household stakes `delete_household_dialog.dart`
/// guards). Returns `true` only if the recipe was actually deleted.
Future<bool> showDeleteRecipeDialog({
  required BuildContext context,
  required RecipeDetailArg arg,
  required Recipe recipe,
}) async {
  final bool? deleted = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => DeleteRecipeDialog(arg: arg, recipe: recipe),
  );
  return deleted ?? false;
}

class DeleteRecipeDialog extends ConsumerWidget {
  const DeleteRecipeDialog({super.key, required this.arg, required this.recipe});

  final RecipeDetailArg arg;
  final Recipe recipe;

  static const Key cancelButtonKey = Key('delete-recipe-cancel');
  static const Key confirmButtonKey = Key('delete-recipe-confirm');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> overflowState = ref.watch(recipeOverflowControllerProvider(arg));
    final bool isBusy =
        overflowState.isLoading &&
        ref.read(recipeOverflowControllerProvider(arg).notifier).action ==
            RecipeOverflowAction.delete;
    final String? errorMessage = recipeErrorMessage(overflowState.error);

    Future<void> confirm() async {
      final bool ok = await ref
          .read(recipeOverflowControllerProvider(arg).notifier)
          .delete();
      if (context.mounted && ok) {
        Navigator.of(context).pop(true);
      }
      // A failure keeps the dialog open with the server's message visible —
      // the recipe still exists, and dismissing would imply otherwise.
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
              'Delete this recipe?',
              style: AppTypography.title.copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              '"${recipe.title}" will be removed from the library.',
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
