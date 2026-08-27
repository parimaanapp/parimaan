import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/recipe_repository.dart';
import '../domain/recipe.dart';
import '../domain/recipe_role.dart';

/// The server-backed read of one household's recipe library, keyed by
/// household id — same *family* reasoning as `PantryController`.
///
/// Deliberately simpler than `PantryController` in one remaining way: no
/// Drift hydrate-then-fetch (local caching for recipes is deferred to W14
/// per D7). Live updates (`onRecipeChanged`, W6 S11/D6) work identically to
/// `PantryController`'s own subscription wiring. `role`/`isFavorite` are
/// filter state owned by this controller; both refetch immediately on
/// change — a chip tap is a single discrete action, not a keystroke stream,
/// so unlike `PantryController.setSearch` there is nothing here to
/// debounce.
class RecipeLibraryController
    extends FamilyAsyncNotifier<List<Recipe>, String> {
  RecipeRepository get _repository => ref.read(recipeRepositoryProvider);

  RecipeRole? _role;
  bool? _isFavorite;

  /// Nullable, not `late final`: `build()` can run more than once on the
  /// same notifier instance, and a second assignment to a `late final`
  /// field throws — same reasoning as `PantryController._changeSubscription`.
  StreamSubscription<void>? _changeSubscription;

  @override
  Future<List<Recipe>> build(String householdId) {
    // Subscribed for as long as this controller (and so the screen watching
    // it) is alive, cancelled on dispose — same "subscribe-on-foreground /
    // unsubscribe-on-background" shape as `PantryController.build`, no
    // reconnect backoff here either (that's a later slice). Errors are
    // swallowed: a live-update channel that never connects must not fail
    // the library read this controller already gets from `fetchRecipes`
    // below — see `watchRecipeChanges`'s own doc for the full reasoning.
    unawaited(_changeSubscription?.cancel());
    _changeSubscription = _repository
        .watchRecipeChanges(householdId)
        .listen((_) => unawaited(_refetch()), onError: (Object _) {});
    ref.onDispose(() => unawaited(_changeSubscription?.cancel()));

    return _repository.fetchRecipes(householdId);
  }

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
