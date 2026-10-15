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

  /// Recipes per page (B2c). 200+ recipe libraries load page by page; the
  /// server caps one page at 200 (`RECIPES_MAX_LIMIT`).
  static const int pageSize = 50;
  static const int _maxLimit = 200;

  RecipeRole? _role;
  bool? _isFavorite;
  bool _hasMore = false;
  bool _loadingMore = false;

  /// `true` while the server may hold recipes beyond those loaded (the last
  /// page came back full). Read by the list to decide whether to ask for
  /// more on scroll.
  bool get hasMore => _hasMore;

  /// `true` while a [loadMore] page is in flight (drives the footer spinner).
  bool get isLoadingMore => _loadingMore;

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
        .listen((_) => unawaited(_refetch(keepLoaded: true)), onError: (Object _) {});
    ref.onDispose(() => unawaited(_changeSubscription?.cancel()));

    // Honours the filters this notifier already holds: `build()` re-runs on
    // every `ref.invalidate` (after a create/edit/delete), and the screen's
    // chips still show the selection — an unfiltered fetch here would
    // silently disagree with them.
    return _fetchPage(householdId, limit: pageSize, offset: 0);
  }

  /// One page fetch that also records whether another page may follow.
  Future<List<Recipe>> _fetchPage(
    String householdId, {
    required int limit,
    required int offset,
  }) async {
    final List<Recipe> page = await _repository.fetchRecipes(
      householdId,
      role: _role,
      isFavorite: _isFavorite,
      limit: limit,
      offset: offset,
    );
    _hasMore = page.length >= limit;
    return page;
  }

  /// Appends the next page to the loaded list. A no-op while another page is
  /// loading, before the first page has arrived, or when nothing is left. A
  /// failure keeps the loaded list (state carries the error alongside it) and
  /// leaves [hasMore] true so the next scroll retries.
  Future<void> loadMore() async {
    final List<Recipe>? loaded = state.valueOrNull;
    if (!_hasMore || _loadingMore || loaded == null || state.isLoading) {
      return;
    }
    _loadingMore = true;
    final AsyncValue<List<Recipe>> previous = state;
    state = const AsyncLoading<List<Recipe>>().copyWithPrevious(previous);

    final AsyncValue<List<Recipe>> result =
        await AsyncValue.guard<List<Recipe>>(() async {
          final List<Recipe> page = await _fetchPage(
            arg,
            limit: pageSize,
            offset: loaded.length,
          );
          final Set<String> seen = loaded.map((Recipe r) => r.id).toSet();
          // A concurrent edit can shift rows across the page boundary; never
          // show one recipe twice.
          return <Recipe>[
            ...loaded,
            ...page.where((Recipe r) => !seen.contains(r.id)),
          ];
        });

    _loadingMore = false;
    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }

  /// Drops both the role and favorites filters with a single refetch.
  Future<void> clearFilters() {
    _role = null;
    _isFavorite = null;
    return _refetch();
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
  ///
  /// [keepLoaded] (live updates) refetches as many rows as are already on
  /// screen in one request, so a push never collapses the user's scrolled
  /// list back to page one; a filter change starts from the first page.
  Future<void> _refetch({bool keepLoaded = false}) async {
    final AsyncValue<List<Recipe>> previous = state;
    state = const AsyncLoading<List<Recipe>>().copyWithPrevious(previous);

    final int loadedCount = previous.valueOrNull?.length ?? 0;
    final int limit = keepLoaded
        ? loadedCount.clamp(pageSize, _maxLimit)
        : pageSize;

    final AsyncValue<List<Recipe>> result =
        await AsyncValue.guard<List<Recipe>>(
          () => _fetchPage(arg, limit: limit, offset: 0),
        );

    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }
}

final AsyncNotifierProviderFamily<RecipeLibraryController, List<Recipe>, String>
recipeLibraryControllerProvider =
    AsyncNotifierProvider.family<RecipeLibraryController, List<Recipe>, String>(
      RecipeLibraryController.new,
    );
