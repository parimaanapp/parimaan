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
  late final SearchDebouncer _searchDebouncer;

  @override
  Future<List<PantryItem>> build(String householdId) {
    _searchDebouncer = SearchDebouncer(
      onSettled: (String? value) {
        _search = value;
        // Fire-and-forget: `onSettled` runs off a `Timer`, with no caller
        // awaiting it — same "unawaited, errors land in state" shape as
        // `HouseholdSyncPolicy._fire`.
        unawaited(_refetch());
      },
    );
    ref.onDispose(_searchDebouncer.dispose);
    return _repository.fetchPantry(householdId);
  }

  /// Records new search text. Coalesced via [SearchDebouncer] — typing does
  /// not produce a request per keystroke.
  void setSearch(String? search) {
    final String? trimmed = search?.trim();
    _searchDebouncer.update(trimmed == null || trimmed.isEmpty ? null : trimmed);
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
