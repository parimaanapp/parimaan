import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../../recipes/data/recipe_repository.dart';
import '../../recipes/domain/recipe.dart';
import '../../recipes/domain/recipe_ingredient.dart';
import '../../recipes/presentation/recipe_card.dart';
import '../domain/current_week.dart';
import '../domain/ingredient_warning.dart';
import '../domain/menu.dart';
import '../state/current_menu_controller.dart';
import '../state/recipe_picker_controller.dart';
import 'ingredient_warning_dialog.dart';

/// The real recipe picker (W10 S5, E2E_MVP_PLAN.md §16.3) — replaces W9's
/// `RecipePickerStubScreen`. Opened from an empty slot on the Weekly plan
/// grid, pre-filtered to that slot's own role via [RecipePickerExtra].
///
/// Resolves its household via [activeHouseholdProvider], same convention as
/// `WeeklyPlanScreen`/`TodayScreen` — this route carries no `:householdId`
/// path segment.
class RecipePickerScreen extends ConsumerWidget {
  const RecipePickerScreen({super.key, required this.extra});

  final RecipePickerExtra extra;

  static const Key loadingKey = Key('recipe-picker-loading');
  static const Key errorKey = Key('recipe-picker-error');
  static const Key emptyStateKey = Key('recipe-picker-empty');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: household == null
            ? const Center(
                key: RecipePickerScreen.loadingKey,
                child: CircularProgressIndicator(),
              )
            : _PickerForHousehold(household: household, extra: extra),
      ),
    );
  }
}

class _PickerForHousehold extends ConsumerWidget {
  const _PickerForHousehold({required this.household, required this.extra});

  final Household household;
  final RecipePickerExtra extra;

  Future<void> _selectRecipe(
    BuildContext context,
    WidgetRef ref,
    Recipe recipe,
  ) async {
    final RecipeRepository recipeRepository = ref.read(recipeRepositoryProvider);
    final Recipe detail;
    try {
      detail = await recipeRepository.fetchRecipeDetail(recipe.id);
    } on AppError catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.errorMessage)));
      }
      return;
    }

    final List<RecipeIngredient> ingredients =
        detail.ingredients ?? const <RecipeIngredient>[];
    final List<String> allergenMatches = matchedIngredientWarningTerms(
      ingredients,
      household.settings.allergens,
    );
    final List<String> skipMatches = matchedIngredientWarningTerms(
      ingredients,
      household.settings.skipIngredients,
    );

    if (allergenMatches.isNotEmpty || skipMatches.isNotEmpty) {
      if (!context.mounted) return;
      final bool proceed = await showIngredientWarningDialog(
        context: context,
        allergenMatches: allergenMatches,
        skipMatches: skipMatches,
      );
      if (!proceed) return;
    }

    if (!context.mounted) return;
    final MenuKey menuKey = menuKeyFor(household.id, currentWeekStartDate());
    try {
      await ref
          .read(currentMenuControllerProvider(menuKey).notifier)
          .addMenuItem(
            NewMenuItem(
              recipeId: recipe.id,
              dayOfWeek: extra.dayOfWeek,
              mealSlot: extra.mealSlot,
              slotRole: extra.slotRole,
            ),
          );
    } on AppError catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.errorMessage)));
      }
      return;
    }
    if (context.mounted) {
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final RecipePickerKey key = (
      householdId: household.id,
      slotRole: extra.slotRole,
    );
    final AsyncValue<List<Recipe>> recipes = ref.watch(
      recipePickerControllerProvider(key),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        PTopBar(
          title: 'Add a ${extra.slotRole.displayLabel.toLowerCase()}',
          onBack: () => context.pop(),
          backSemanticLabel: 'Back to weekly plan',
        ),
        Expanded(
          child: switch (recipes) {
            AsyncData<List<Recipe>>(:final List<Recipe> value) => value.isEmpty
                ? Center(
                    key: RecipePickerScreen.emptyStateKey,
                    child: PEmptyState(
                      headline: 'No ${extra.slotRole.displayLabel.toLowerCase()} recipes yet',
                      body: 'Add one from the Recipes tab, then come back to plan this slot.',
                      action: PButton(
                        label: 'Add a recipe',
                        variant: PButtonVariant.secondary,
                        onPressed: () => context.push(
                          AppRoutes.recipeChooseMethod(household.id),
                        ),
                      ),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: value.length,
                    itemBuilder: (BuildContext context, int index) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: RecipeCard(
                        recipe: value[index],
                        onTap: () => _selectRecipe(context, ref, value[index]),
                      ),
                    ),
                  ),
            AsyncValue<List<Recipe>>(hasError: true) => Center(
              key: RecipePickerScreen.errorKey,
              child: PEmptyState(
                headline: 'Could not load recipes',
                body: recipes.error is AppError
                    ? (recipes.error! as AppError).errorMessage
                    : '',
                action: PButton(
                  label: 'Try again',
                  variant: PButtonVariant.secondary,
                  onPressed: () => ref.invalidate(
                    recipePickerControllerProvider(key),
                  ),
                ),
              ),
            ),
            _ => const Center(
              key: RecipePickerScreen.loadingKey,
              child: CircularProgressIndicator(),
            ),
          },
        ),
      ],
    );
  }
}
