import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/recipe_repository.dart';
import '../domain/recipe.dart';
import '../domain/recipe_role.dart';

/// The server-backed read of one household's recipe library, keyed by
/// household id — same *family* reasoning as `PantryController`.
///
/// Deliberately simpler than `PantryController`: no Drift hydrate-then-fetch
/// (local caching for recipes is deferred to W14 per D7) and no live-update
/// subscription (`onRecipeChanged` is S11, a later slice). `role`/
/// `isFavorite` are filter state owned by this controller; both refetch
/// immediately on change — a chip tap is a single discrete action, not a
/// keystroke stream, so unlike `PantryController.setSearch` there is nothing
/// here to debounce.
class RecipeLibraryController
    extends FamilyAsyncNotifier<List<Recipe>, String> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  RecipeRole? _role;
  bool? _isFavorite;

  @override
  Future<List<Recipe>> build(String householdId) =>
      _repository.fetchRecipes(householdId);

  /// Applies (or clears, with `null`) a role filter and refetches
  /// immediately.
  Future<void> setRoleFilter(RecipeRole? role) {
    _role = role;
    return _refetch();
  }

  /// Applies (or clears, with `null`) a favorites-only filter and refetches
  /// immediately.
  Future<void> setFavoritesFilter(bool? isFavorite) {
    _isFavorite = isFavorite;
    return _refetch();
  }

  /// Same `copyWithPrevious` shape as `PantryController._refetch`: a failed
  /// refetch keeps the last good list on screen rather than blanking it.
  Future<void> _refetch() async {
    final AsyncValue<List<Recipe>> previous = state;
    state = const AsyncLoading<List<Recipe>>().copyWithPrevious(previous);

    final AsyncValue<List<Recipe>> result = await AsyncValue.guard<List<Recipe>>(
      () => _repository.fetchRecipes(arg, role: _role, isFavorite: _isFavorite),
    );

    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }
}

final AsyncNotifierProviderFamily<RecipeLibraryController, List<Recipe>, String>
recipeLibraryControllerProvider =
    AsyncNotifierProvider.family<RecipeLibraryController, List<Recipe>, String>(
      RecipeLibraryController.new,
    );
