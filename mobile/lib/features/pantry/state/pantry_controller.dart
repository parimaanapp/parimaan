import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

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

    return _repository.fetchPantry(householdId);
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
