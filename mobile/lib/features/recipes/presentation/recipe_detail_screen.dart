import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../domain/recipe.dart';
import '../domain/recipe_ingredient.dart';
import '../state/recipe_detail_controller.dart';
import 'recipe_overflow_menu.dart';

/// Wireframe screens 7.2/7.3 — the Recipe Detail screen plus the Overflow
/// menu entry point (W6 S7). Resolves its household the same way
/// `RecipesLibraryScreen` does — via `activeHouseholdProvider` — since
/// [recipeId] alone (the route param) isn't enough to build
/// [RecipeDetailArg]'s `householdId` half without a network round trip.
class RecipeDetailScreen extends ConsumerWidget {
  const RecipeDetailScreen({super.key, required this.recipeId});

  final String recipeId;

  static const Key errorStateKey = Key('recipe-detail-error');
  static const Key overflowButtonKey = Key('recipe-detail-overflow');
  static const Key favoriteBadgeKey = Key('recipe-detail-favorite');
  static const Key inRotationBadgeKey = Key('recipe-detail-in-rotation');
  static const Key totalTimeKey = Key('recipe-detail-total-time');
  static const Key ingredientsEmptyKey = Key('recipe-detail-ingredients-empty');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: household == null
            ? const Center(child: CircularProgressIndicator())
            : _RecipeDetailForHousehold(
                arg: (householdId: household.id, id: recipeId),
              ),
      ),
    );
  }
}

class _RecipeDetailForHousehold extends ConsumerWidget {
  const _RecipeDetailForHousehold({required this.arg});

  final RecipeDetailArg arg;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Recipe> detail = ref.watch(recipeDetailControllerProvider(arg));

    Future<void> openOverflowMenu() async {
      final bool deleted = await showRecipeOverflowMenu(context: context, arg: arg);
      if (deleted && context.mounted) {
        context.pop();
      }
    }

    return switch ((detail.valueOrNull, detail.error)) {
      (final Recipe recipe, _) => _RecipeDetailBody(
        recipe: recipe,
        onOverflowTap: openOverflowMenu,
      ),
      (null, final Object error) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Recipe',
            onBack: () => context.pop(),
            backSemanticLabel: 'Back to recipes',
          ),
          Expanded(
            child: Center(
              key: RecipeDetailScreen.errorStateKey,
              child: PEmptyState(
                headline: 'Could not load this recipe',
                body: error is AppError ? error.errorMessage : '',
                action: PButton(
                  label: 'Try again',
                  variant: PButtonVariant.secondary,
                  onPressed: () => ref.invalidate(recipeDetailControllerProvider(arg)),
                ),
              ),
            ),
          ),
        ],
      ),
      _ => const Center(child: CircularProgressIndicator()),
    };
  }
}

class _RecipeDetailBody extends StatelessWidget {
  const _RecipeDetailBody({required this.recipe, required this.onOverflowTap});

  final Recipe recipe;
  final VoidCallback onOverflowTap;

  @override
  Widget build(BuildContext context) {
    final int? totalTimeMin = recipe.totalTimeMin;
    final List<RecipeIngredient> ingredients = recipe.ingredients ?? const <RecipeIngredient>[];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        PTopBar(
          title: recipe.title,
          onBack: () => context.pop(),
          backSemanticLabel: 'Back to recipes',
          trailing: PButton.icon(
            key: RecipeDetailScreen.overflowButtonKey,
            icon: Icons.more_vert,
            semanticLabel: 'More actions',
            variant: PButtonVariant.ghost,
            onPressed: onOverflowTap,
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(AppSpacing.s3),
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      recipe.role.displayLabel,
                      style: AppTypography.label.copyWith(color: AppColors.inkMid),
                    ),
                  ),
                  if (recipe.isFavorite)
                    const Padding(
                      padding: EdgeInsets.only(left: AppSpacing.s1),
                      child: PBadge(
                        key: RecipeDetailScreen.favoriteBadgeKey,
                        label: 'Favorite',
                        tone: PBadgeTone.accent,
                        icon: Icons.favorite,
                      ),
                    ),
                  if (recipe.inRotation)
                    const Padding(
                      padding: EdgeInsets.only(left: AppSpacing.s1),
                      child: PBadge(
                        key: RecipeDetailScreen.inRotationBadgeKey,
                        label: 'In rotation',
                        tone: PBadgeTone.success,
                      ),
                    ),
                ],
              ),
              if (totalTimeMin != null) ...<Widget>[
                const SizedBox(height: AppSpacing.s0),
                Text(
                  '$totalTimeMin min · Serves ${recipe.servings}',
                  key: RecipeDetailScreen.totalTimeKey,
                  style: AppTypography.label.copyWith(color: AppColors.inkMid),
                ),
              ],
              if (recipe.description != null) ...<Widget>[
                const SizedBox(height: AppSpacing.s2),
                Text(
                  recipe.description!,
                  style: AppTypography.body.copyWith(color: AppColors.ink),
                ),
              ],
              const SizedBox(height: AppSpacing.s3),
              Text(
                'Ingredients',
                style: AppTypography.title.copyWith(color: AppColors.ink),
              ),
              const SizedBox(height: AppSpacing.s1),
              if (ingredients.isEmpty)
                Text(
                  'No ingredients listed.',
                  key: RecipeDetailScreen.ingredientsEmptyKey,
                  style: AppTypography.label.copyWith(color: AppColors.inkMid),
                )
              else
                for (final RecipeIngredient ingredient in ingredients)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.s0),
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            _ingredientLabel(ingredient),
                            style: AppTypography.body.copyWith(color: AppColors.ink),
                          ),
                        ),
                        if (ingredient.isStaple)
                          const PBadge(label: 'Staple', tone: PBadgeTone.neutral),
                      ],
                    ),
                  ),
              const SizedBox(height: AppSpacing.s3),
              Text('Steps', style: AppTypography.title.copyWith(color: AppColors.ink)),
              const SizedBox(height: AppSpacing.s1),
              for (int i = 0; i < recipe.steps.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.s1),
                  child: Text(
                    '${i + 1}. ${recipe.steps[i]}',
                    style: AppTypography.body.copyWith(color: AppColors.ink),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  String _ingredientLabel(RecipeIngredient ingredient) {
    final String? quantity = ingredient.quantity == null
        ? null
        : '${ingredient.quantity}';
    final String? unit = ingredient.unit;
    final String amount = <String>[?quantity, ?unit].join(' ');
    return amount.isEmpty ? ingredient.name : '$amount ${ingredient.name}';
  }
}
