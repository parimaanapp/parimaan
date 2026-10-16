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

  /// Most rows a rebuild or live-update refetch will restore in one go.
  static const int _maxRestore = 1000;

  /// Live-update pushes inside this window collapse into one refetch.
  static const Duration liveUpdateDebounce = Duration(milliseconds: 500);

  RecipeRole? _role;
  bool? _isFavorite;
  bool _hasMore = false;
  bool _loadingMore = false;
  bool _loadMoreFailed = false;
  int _loadedCount = 0;

  /// Bumped by every operation that replaces the list (build, refetch). An
  /// async result is applied only if the generation it started under is still
  /// current, so a slow older request can never overwrite a newer one.
  int _generation = 0;
  Timer? _liveUpdateTimer;

  /// `true` while the server may hold recipes beyond those loaded (the last
  /// page came back full). Read by the list to decide whether to ask for
  /// more on scroll.
  bool get hasMore => _hasMore;

  /// `true` while a [loadMore] page is in flight (drives the footer spinner).
  bool get isLoadingMore => _loadingMore;

  /// `true` after a [loadMore] failed, until the next successful load or
  /// refetch. Scroll-driven calls stop; the list offers an explicit retry.
  bool get loadMoreFailed => _loadMoreFailed;

  /// Nullable, not `late final`: `build()` can run more than once on the
  /// same notifier instance, and a second assignment to a `late final`
  /// field throws — same reasoning as `PantryController._changeSubscription`.
  StreamSubscription<void>? _changeSubscription;

  @override
  Future<List<Recipe>> build(String householdId) {
    // Subscribed for as long as this controller (and so the screen watching
    // it) is alive, cancelled on dispose. Errors are swallowed: a live-update
    // channel that never connects must not fail the library read this
    // controller already gets from `fetchRecipes` below.
    unawaited(_changeSubscription?.cancel());
    _changeSubscription = _repository
        .watchRecipeChanges(householdId)
        .listen((_) => _scheduleLiveRefetch(), onError: (Object _) {});
    ref.onDispose(() {
      _liveUpdateTimer?.cancel();
      unawaited(_changeSubscription?.cancel());
    });

    final int generation = ++_generation;
    _loadingMore = false;
    _loadMoreFailed = false;
    // Honours the filters this notifier already holds, and the rows already
    // loaded: `build()` re-runs on every `ref.invalidate` (after a
    // create/edit/delete), which must not collapse a scrolled list to page one.
    return _fetchLoaded(householdId, generation, _loadedCount);
  }

  void _scheduleLiveRefetch() {
    _liveUpdateTimer?.cancel();
    _liveUpdateTimer = Timer(
      liveUpdateDebounce,
      () => unawaited(_refetch(keepLoaded: true)),
    );
  }

  /// Fetches the first `max(pageSize, count)` rows (capped) in chunks of at
  /// most the server limit, recording whether more may follow. Writes
  /// [_hasMore] and [_loadedCount] only while [generation] is current.
  Future<List<Recipe>> _fetchLoaded(
    String householdId,
    int generation,
    int count,
  ) async {
    final int target = count.clamp(pageSize, _maxRestore);
    final List<Recipe> rows = <Recipe>[];
    bool more = true;
    while (rows.length < target && more) {
      final int limit = (target - rows.length).clamp(1, _maxLimit);
      final List<Recipe> chunk = await _repository.fetchRecipes(
        householdId,
        role: _role,
        isFavorite: _isFavorite,
        limit: limit,
        offset: rows.length,
      );
      rows.addAll(chunk);
      more = chunk.length >= limit;
    }
    if (generation == _generation) {
      _hasMore = more;
      _loadedCount = rows.length;
    }
    return rows;
  }

  /// Appends the next page to the loaded list. A no-op while another page is
  /// loading, before the first page has arrived, when nothing is left, or
  /// after a failure unless [retry] is set. A failure keeps the loaded list
  /// (state carries the error alongside it).
  Future<void> loadMore({bool retry = false}) async {
    final List<Recipe>? loaded = state.valueOrNull;
    if (!_hasMore ||
        _loadingMore ||
        loaded == null ||
        state.isLoading ||
        (_loadMoreFailed && !retry)) {
      return;
    }
    final int generation = _generation;
    _loadingMore = true;
    _loadMoreFailed = false;
    final AsyncValue<List<Recipe>> previous = state;
    state = const AsyncLoading<List<Recipe>>().copyWithPrevious(previous);

    final AsyncValue<(List<Recipe>, bool)> result =
        await AsyncValue.guard<(List<Recipe>, bool)>(() async {
          final List<Recipe> page = await _repository.fetchRecipes(
            arg,
            role: _role,
            isFavorite: _isFavorite,
            limit: pageSize,
            offset: loaded.length,
          );
          final Set<String> seen = loaded.map((Recipe r) => r.id).toSet();
          // A concurrent edit can shift rows across the page boundary; never
          // show one recipe twice.
          return (
            <Recipe>[
              ...loaded,
              ...page.where((Recipe r) => !seen.contains(r.id)),
            ],
            page.length >= pageSize,
          );
        });

    if (generation != _generation) {
      // A refetch/rebuild replaced the list while this page was in flight;
      // it owns the state (and reset the loading flags) now.
      return;
    }
    _loadingMore = false;
    if (result.hasError) {
      _loadMoreFailed = true;
      state = AsyncError<List<Recipe>>(
        result.error!,
        result.stackTrace ?? StackTrace.current,
      ).copyWithPrevious(previous);
      return;
    }
    final (List<Recipe> rows, bool more) = result.requireValue;
    _hasMore = more;
    _loadedCount = rows.length;
    state = AsyncData<List<Recipe>>(rows);
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
  /// screen, so a push never collapses the user's scrolled list back to page
  /// one; a filter change starts from the first page. Each call takes a new
  /// generation, so overlapping refetches resolve to the latest one.
  Future<void> _refetch({bool keepLoaded = false}) async {
    final int generation = ++_generation;
    _loadingMore = false;
    _loadMoreFailed = false;
    final AsyncValue<List<Recipe>> previous = state;
    state = const AsyncLoading<List<Recipe>>().copyWithPrevious(previous);

    final AsyncValue<List<Recipe>> result =
        await AsyncValue.guard<List<Recipe>>(
          () => _fetchLoaded(arg, generation, keepLoaded ? _loadedCount : 0),
        );

    if (generation != _generation) {
      return;
    }
    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }
}

final AsyncNotifierProviderFamily<RecipeLibraryController, List<Recipe>, String>
recipeLibraryControllerProvider =
    AsyncNotifierProvider.family<RecipeLibraryController, List<Recipe>, String>(
      RecipeLibraryController.new,
    );
