import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/storage/app_database.dart';
import '../../../shared/storage/daos/pantry_dao.dart';
import '../data/pantry_repository.dart';
import '../domain/pantry_item.dart';
import 'search_debouncer.dart';

/// The server-backed read of one household's pantry, keyed by household id.
///
/// A *family* for the same reason `CurrentHouseholdController` is: a
/// household id is the only sensible key, and a user viewing two households'
/// pantries (a later multi-household concept) must not have one overwrite
/// the other's cached list.
///
/// `search`/`category` are filter state owned by this controller, not by the
/// screen — [setSearch] is debounced via [SearchDebouncer] (400ms of quiet
/// before it fires), [setCategory] refetches immediately (a chip tap is a
/// single discrete action, not a keystroke stream, so there is nothing to
/// coalesce).
class PantryController extends FamilyAsyncNotifier<List<PantryItem>, String> {
  PantryRepository get _repository => ref.read(pantryRepositoryProvider);
  PantryDao get _dao => ref.read(appDatabaseProvider).pantryDao;

  String? _search;
  String? _category;

  /// Not `late final`: `build()` can run more than once on the *same*
  /// notifier instance — `ref.invalidate(pantryControllerProvider(...))`
  /// (used by `PantryFormController` after a successful add/update/delete)
  /// triggers exactly that, and a second assignment to a `late final` field
  /// throws `LateInitializationError`. Caught by
  /// `pantry_form_controller_test.dart`'s invalidation test, not by
  /// inspection — this field's own tests never exercised a second `build()`.
  SearchDebouncer? _searchDebouncer;

  /// Same nullable-not-`late-final` reasoning as [_searchDebouncer] —
  /// `build()` reassigns this on every run.
  StreamSubscription<void>? _changeSubscription;

  @override
  Future<List<PantryItem>> build(String householdId) {
    // A stale debouncer from a previous `build()` could still have a pending
    // timer; disposing it before replacing avoids two debouncers racing to
    // call `_refetch()` for the same controller instance.
    _searchDebouncer?.dispose();
    _searchDebouncer = SearchDebouncer(
      onSettled: (String? value) {
        _search = value;
        // Fire-and-forget: `onSettled` runs off a `Timer`, with no caller
        // awaiting it — same "unawaited, errors land in state" shape as
        // `HouseholdSyncPolicy._fire`.
        unawaited(_refetch());
      },
    );
    ref.onDispose(() => _searchDebouncer?.dispose());

    // Live updates (S8) — subscribed for as long as this controller (and so
    // the screen watching it) is alive, and cancelled on dispose, which is
    // this family provider's version of "subscribe-on-foreground /
    // unsubscribe-on-background" (E2E_MVP_PLAN.md §11.3 S8 step 2d — no
    // reconnect backoff in W5). Errors are swallowed: a live-update channel
    // that never connects must not fail the pantry read this controller
    // already got from `fetchPantry` below — see `watchPantryChanges`'s own
    // doc for the full reasoning.
    unawaited(_changeSubscription?.cancel());
    _changeSubscription = _repository
        .watchPantryChanges(householdId)
        .listen((_) => unawaited(_refetch()), onError: (Object _) {});
    ref.onDispose(() => unawaited(_changeSubscription?.cancel()));

    return _hydrateThenFetch(householdId);
  }

  /// Hydrate-then-fetch (W5 S7, SD §9.1): shows whatever is cached for
  /// [householdId] immediately (if anything), then fetches fresh from the
  /// network and overwrites the cache wholesale — no field-level merge, the
  /// server's answer always wins outright.
  ///
  /// Only the plain, unfiltered fetch below ever writes to the cache.
  /// [_refetch] (search/category changes, and every live-update-triggered
  /// refetch) deliberately does not: it can run with an active `search`/
  /// `category` filter, and writing a filtered subset through
  /// [PantryDao.replaceAll] — a per-household *wholesale* overwrite — would
  /// silently evict every cached row the filter excluded. The `assert`
  /// below is a debug-build guard against that invariant ever regressing
  /// silently, since nothing else in the type system enforces it.
  Future<List<PantryItem>> _hydrateThenFetch(String householdId) async {
    final List<PantryItem> cached = await _readCachedSafely(householdId);
    if (cached.isNotEmpty) {
      state = AsyncData<List<PantryItem>>(cached);
    }

    final List<PantryItem> fresh;
    try {
      fresh = await _repository.fetchPantry(householdId);
    } on Object catch (error, stackTrace) {
      if (cached.isEmpty) {
        rethrow;
      }
      // The whole value of the cache: a network failure after a successful
      // hydrate leaves the cached rows visible (with the error attached),
      // not an empty screen. `copyWithPrevious` is what keeps `state.value`
      // populated alongside `state.error` — confirmed this survives
      // `AsyncNotifier`'s own build-failure handling rather than being
      // clobbered by it (see `pantry_controller_test.dart`).
      state = AsyncError<List<PantryItem>>(
        error,
        stackTrace,
      ).copyWithPrevious(AsyncData<List<PantryItem>>(cached));
      rethrow;
    }

    assert(
      _search == null && _category == null,
      'only the unfiltered build()-time fetch may write to the cache — a '
      'filtered replaceAll would evict rows the filter excludes',
    );
    try {
      await _dao.replaceAll(householdId, fresh);
    } on Object {
      // Best-effort: a local cache-write failure must never discard an
      // already-successful network result — the whole point of `fresh`
      // reaching the caller is to show the user real, current data.
    }
    return fresh;
  }

  /// The hydrate step is best-effort — a broken local cache must degrade to
  /// "skip it, fetch from network" rather than failing the whole screen.
  Future<List<PantryItem>> _readCachedSafely(String householdId) async {
    try {
      return await _dao.readPantryItems(householdId);
    } on Object {
      return const <PantryItem>[];
    }
  }

  /// Records new search text. Coalesced via [SearchDebouncer] — typing does
  /// not produce a request per keystroke.
  void setSearch(String? search) {
    final String? trimmed = search?.trim();
    _searchDebouncer?.update(trimmed == null || trimmed.isEmpty ? null : trimmed);
  }

  /// Applies (or clears, with `null`) a category filter and refetches
  /// immediately.
  Future<void> setCategory(String? category) {
    _category = category;
    return _refetch();
  }

  /// Same `copyWithPrevious` shape as `CurrentHouseholdController.refresh`:
  /// a failed refetch keeps the last good list on screen rather than
  /// blanking it.
  Future<void> _refetch() async {
    final AsyncValue<List<PantryItem>> previous = state;
    state = const AsyncLoading<List<PantryItem>>().copyWithPrevious(previous);

    final AsyncValue<List<PantryItem>> result =
        await AsyncValue.guard<List<PantryItem>>(
          () => _repository.fetchPantry(arg, search: _search, category: _category),
        );

    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }
}

final AsyncNotifierProviderFamily<PantryController, List<PantryItem>, String>
pantryControllerProvider =
    AsyncNotifierProvider.family<PantryController, List<PantryItem>, String>(
      PantryController.new,
    );
