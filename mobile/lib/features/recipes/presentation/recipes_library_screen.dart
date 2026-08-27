import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/errors/app_error.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../household/domain/household.dart';
import '../../household/state/current_household_controller.dart';
import '../domain/recipe.dart';
import '../domain/recipe_role.dart';
import '../state/recipe_library_controller.dart';
import 'recipe_card.dart';

/// Wireframe screen 12.2.11 — the Recipes Library. The Recipes tab of the W6
/// nav shell (S6); reads the network only, no local cache and no
/// subscription (both later — W14, S11).
///
/// Resolves its household the same way `PantryListScreen` does — via
/// `activeHouseholdProvider` — since the shell route this renders under
/// carries no `:householdId` path segment.
class RecipesLibraryScreen extends ConsumerWidget {
  const RecipesLibraryScreen({super.key});

  static const Key emptyStateKey = Key('recipes-library-empty');
  static const Key errorStateKey = Key('recipes-library-error');
  static const Key favoritesChipKey = Key('recipes-library-favorites-chip');
  static const Key staleBannerKey = Key('recipes-library-stale-banner');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Household? household = ref.watch(activeHouseholdProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: household == null
            ? const Center(child: CircularProgressIndicator())
            : _RecipesForHousehold(householdId: household.id),
      ),
    );
  }
}

class _RecipesForHousehold extends ConsumerStatefulWidget {
  const _RecipesForHousehold({required this.householdId});

  final String householdId;

  @override
  ConsumerState<_RecipesForHousehold> createState() =>
      _RecipesForHouseholdState();
}

class _RecipesForHouseholdState extends ConsumerState<_RecipesForHousehold> {
  RecipeRole? _selectedRole;
  bool _favoritesOnly = false;

  RecipeLibraryController get _controller => ref.read(
    recipeLibraryControllerProvider(widget.householdId).notifier,
  );

  /// Re-applies the filters this widget already believes are selected,
  /// rather than `ref.invalidate`-ing the whole controller. Invalidating
  /// would re-run `build()` with no filter args, silently dropping an active
  /// role/favorites filter the chips still show as selected — this keeps the
  /// chip UI and the controller's own filter state in agreement after a
  /// failed fetch, whether that failure was the initial load or a filter
  /// change. `setRoleFilter` refetches using the controller's own
  /// already-current `_isFavorite`, so a single call re-applies both.
  void _retry() => _controller.setRoleFilter(_selectedRole);

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Recipe>> recipes = ref.watch(
      recipeLibraryControllerProvider(widget.householdId),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const PTopBar(title: 'Recipes'),
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.only(right: AppSpacing.s1),
                child: PChip(
                  key: RecipesLibraryScreen.favoritesChipKey,
                  label: 'Favorites',
                  selected: _favoritesOnly,
                  onTap: () {
                    final bool next = !_favoritesOnly;
                    setState(() => _favoritesOnly = next);
                    _controller.setFavoritesFilter(next ? true : null);
                  },
                ),
              ),
              for (final RecipeRole role in RecipeRole.selectable)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.s1),
                  child: PChip(
                    label: role.displayLabel,
                    selected: _selectedRole == role,
                    onTap: () {
                      final RecipeRole? next = _selectedRole == role
                          ? null
                          : role;
                      setState(() => _selectedRole = next);
                      _controller.setRoleFilter(next);
                    },
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.s2),
        Expanded(
          child: switch ((recipes.valueOrNull, recipes.error)) {
            (final List<Recipe> items, final Object error)
                when items.isNotEmpty => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                // A failed filter refetch keeps the last-good list on screen
                // (`RecipeLibraryController._refetch`'s `copyWithPrevious`)
                // rather than blanking it — this banner is what stops that
                // stale list from silently passing as a successful one.
                Padding(
                  key: RecipesLibraryScreen.staleBannerKey,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.s3,
                    vertical: AppSpacing.s1,
                  ),
                  child: PBadge(
                    label: error is AppError
                        ? error.errorMessage
                        : genericErrorMessage,
                    tone: PBadgeTone.warning,
                    uppercase: false,
                  ),
                ),
                Expanded(child: _RecipeList(items: items)),
              ],
            ),
            (final List<Recipe> items, _) when items.isNotEmpty =>
              _RecipeList(items: items),
            (final List<Recipe> items, _) when items.isEmpty => Center(
              key: RecipesLibraryScreen.emptyStateKey,
              child: PEmptyState(
                headline: 'No recipes yet',
                body: 'Add a recipe to start building your library.',
                action: PButton(
                  label: 'Add a recipe',
                  variant: PButtonVariant.secondary,
                  // Disabled: the add flow is a later slice (S8), so there
                  // is nowhere for this to navigate yet. `PEmptyState.action`
                  // is still required, and a visibly-disabled button is
                  // truthful about "not yet" in a way a silent no-op tap
                  // would not be.
                  onPressed: null,
                ),
              ),
            ),
            (null, final Object error) => Center(
              key: RecipesLibraryScreen.errorStateKey,
              child: PEmptyState(
                headline: 'Could not load recipes',
                body: error is AppError ? error.errorMessage : '',
                action: PButton(
                  label: 'Try again',
                  variant: PButtonVariant.secondary,
                  onPressed: _retry,
                ),
              ),
            ),
            _ => const Center(child: CircularProgressIndicator()),
          },
        ),
      ],
    );
  }
}

class _RecipeList extends StatelessWidget {
  const _RecipeList({required this.items});

  final List<Recipe> items;

  // `.builder`, not a plain `ListView(children: ...)`: unlike
  // `PantryListScreen` (a household's pantry, no perf target set for it),
  // this list is the one E2E_MVP_PLAN.md §12's S9 perf spike scrolls at 300
  // items — recycling only holds if the list is builder-backed from the
  // start, not bolted on after a spike finds it missing.
  @override
  Widget build(BuildContext context) => ListView.builder(
    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
    itemCount: items.length,
    itemBuilder: (BuildContext context, int index) {
      final Recipe recipe = items[index];
      return Padding(
        key: ValueKey<String>(recipe.id),
        padding: const EdgeInsets.only(bottom: AppSpacing.s1),
        child: RecipeCard(
          recipe: recipe,
          onTap: () => context.push(AppRoutes.recipeDetail(recipe.id)),
        ),
      );
    },
  );
}
