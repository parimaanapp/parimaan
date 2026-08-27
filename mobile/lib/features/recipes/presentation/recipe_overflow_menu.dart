import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/recipe.dart';
import '../state/recipe_detail_controller.dart';
import '../state/recipe_overflow_controller.dart';
import 'delete_recipe_dialog.dart';
import 'recipes_error_copy.dart';

/// The Detail screen's Overflow menu (wireframe 7.3, W6 S7): toggle
/// favorite, toggle rotation, edit, delete. A modal bottom sheet, not a
/// `PopupMenuButton` — no menu primitive exists yet in `shared/ui`, and a
/// bottom sheet matches this design system's `PCard`-row list language
/// (`SettingsRow`'s precedent) better than a compact dropdown would for
/// four actions, one of them destructive.
///
/// Returns `true` only if the recipe was deleted while the sheet was open —
/// the Detail screen's own caller uses this to pop itself back to the
/// Library, since there is nothing left to display.
Future<bool> showRecipeOverflowMenu({
  required BuildContext context,
  required RecipeDetailArg arg,
}) async {
  final bool? deleted = await showModalBottomSheet<bool>(
    context: context,
    backgroundColor: AppColors.paper,
    builder: (BuildContext context) => RecipeOverflowMenu(arg: arg),
  );
  return deleted ?? false;
}

class RecipeOverflowMenu extends ConsumerWidget {
  const RecipeOverflowMenu({super.key, required this.arg});

  final RecipeDetailArg arg;

  static const Key favoriteRowKey = Key('recipe-overflow-favorite');
  static const Key rotationRowKey = Key('recipe-overflow-rotation');
  static const Key editRowKey = Key('recipe-overflow-edit');
  static const Key deleteRowKey = Key('recipe-overflow-delete');
  static const Key errorKey = Key('recipe-overflow-error');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The menu reads the live recipe (not a snapshot from when it opened) so
    // a toggle tap immediately reflects in this same sheet — `applyUpdatedRecipe`
    // pushes the mutation's result into this same provider.
    final Recipe? recipe = ref
        .watch(recipeDetailControllerProvider(arg))
        .valueOrNull;
    final AsyncValue<void> overflowState = ref.watch(
      recipeOverflowControllerProvider(arg),
    );
    final RecipeOverflowAction action = ref
        .read(recipeOverflowControllerProvider(arg).notifier)
        .action;
    final bool isBusy = overflowState.isLoading;
    final String? errorMessage = recipeErrorMessage(overflowState.error);

    if (recipe == null) {
      // The Detail screen never opens this menu before its own recipe has
      // loaded — see `RecipeDetailScreen`. Defensive, not a real path.
      return const SizedBox.shrink();
    }

    return SafeArea(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s3),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _OverflowRow(
                key: favoriteRowKey,
                label: recipe.isFavorite ? 'Remove favorite' : 'Favorite',
                isLoading: isBusy && action == RecipeOverflowAction.favorite,
                onTap: isBusy
                    ? null
                    : () => ref
                          .read(recipeOverflowControllerProvider(arg).notifier)
                          .setFavorite(!recipe.isFavorite),
              ),
              _OverflowRow(
                key: rotationRowKey,
                label: recipe.inRotation
                    ? 'Remove from rotation'
                    : 'Add to rotation',
                isLoading: isBusy && action == RecipeOverflowAction.rotation,
                onTap: isBusy
                    ? null
                    : () => ref
                          .read(recipeOverflowControllerProvider(arg).notifier)
                          .setInRotation(!recipe.inRotation),
              ),
              // Always shown (E2E_MVP_PLAN.md §12.7 D2), even though the
              // create/edit form (S8) hasn't shipped yet this week — disabled,
              // not hidden, per this session's own "visibly disabled beats a
              // silent no-op" convention (`RecipesLibraryScreen`'s empty-state
              // "Add a recipe" button).
              const _OverflowRow(key: editRowKey, label: 'Edit', onTap: null),
              _OverflowRow(
                key: deleteRowKey,
                label: 'Delete',
                isDanger: true,
                onTap: isBusy
                    ? null
                    : () async {
                        final bool deleted = await showDeleteRecipeDialog(
                          context: context,
                          arg: arg,
                          recipe: recipe,
                        );
                        if (deleted && context.mounted) {
                          Navigator.of(context).pop(true);
                        }
                      },
              ),
              if (errorMessage != null) ...<Widget>[
                const SizedBox(height: AppSpacing.s1),
                Text(
                  errorMessage,
                  key: errorKey,
                  style: AppTypography.label.copyWith(color: AppColors.danger),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// One row in the Overflow sheet — same `PCard` + label shape as
/// `SettingsRow` (a different feature's file, so not imported directly),
/// without that component's chevron/value slots this menu doesn't need.
class _OverflowRow extends StatelessWidget {
  const _OverflowRow({
    super.key,
    required this.label,
    required this.onTap,
    this.isDanger = false,
    this.isLoading = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool isDanger;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onTap != null && !isLoading;
    final Color labelColor = isDanger
        ? AppColors.danger
        : (enabled ? AppColors.ink : AppColors.inkMid);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s1),
      child: PCard(
        onTap: enabled ? onTap : null,
        semanticLabel: label,
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: AppSizing.minTouchTargetHeight,
          ),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  label,
                  style: AppTypography.body.copyWith(color: labelColor),
                ),
              ),
              if (isLoading)
                const SizedBox(
                  width: AppSizing.icon16,
                  height: AppSizing.icon16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
