import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/menu_repository.dart';
import '../domain/current_week.dart';
import '../domain/menu.dart';

/// The compound key [CurrentMenuController] is keyed on — a household id
/// alone isn't enough (E2E_MVP_PLAN.md §15.3 S4): a user can view multiple
/// weeks (the Weekly plan screen defaults to the current week, but nothing
/// here should assume there is only ever one), and each week's menu must
/// cache independently, the same reasoning `CurrentHouseholdController`'s
/// own doc gives for keying on a household id in the first place.
///
/// A plain Dart record rather than a hand-written class: records have
/// built-in structural `==`/`hashCode` (Dart 3), which is exactly what a
/// `FamilyAsyncNotifier` key needs and what every hand-written value type in
/// this codebase (`HouseholdMember`, `MenuItem`, ...) otherwise has to
/// implement by hand.
///
/// **`weekStartDate` must be UTC midnight** — always construct a [MenuKey]
/// via [menuKeyFor], never a raw record literal. `DateTime.==` compares
/// `isUtc` and microseconds, not just the calendar date, so two `DateTime`s
/// that mean "the same week" (a UTC one from a server response vs. a local
/// one from `DateTime.now()`-derived date math a future screen might
/// reasonably write) would otherwise hash to two DIFFERENT family instances
/// — two independent fetch/create round trips, two cache slots, and a
/// mutation refreshing one while a widget watches the other, all silently.
/// [menuKeyFor] exists specifically so no call site has to get this right by
/// hand; [CurrentMenuController.build] asserts it in debug/test builds as a
/// loud backstop.
typedef MenuKey = ({String householdId, DateTime weekStartDate});

/// The only sanctioned way to build a [MenuKey] — normalizes [weekStartDate]
/// to UTC midnight first. See [MenuKey]'s own doc for why this matters.
MenuKey menuKeyFor(String householdId, DateTime weekStartDate) =>
    (householdId: householdId, weekStartDate: utcMidnight(weekStartDate));

/// `true` iff [weekStartDate] is exactly what [menuKeyFor] would have
/// produced — UTC, midnight, no sub-day component.
bool _isCanonicalWeekStartDate(DateTime weekStartDate) =>
    weekStartDate.isUtc &&
    weekStartDate.hour == 0 &&
    weekStartDate.minute == 0 &&
    weekStartDate.second == 0 &&
    weekStartDate.millisecond == 0 &&
    weekStartDate.microsecond == 0;

/// The server-backed read of one household's menu for one week, keyed by
/// [MenuKey] — a *family*, same reasoning as `CurrentHouseholdController`.
///
/// `build` gets-or-creates rather than only reading: [MenuRepository.fetchMenu]
/// returning `null` (no menu yet for this week — the expected first-visit
/// state, not an error) falls through to [MenuRepository.createMenu], so the
/// Weekly plan screen always has a real `Menu` to render an (empty) grid
/// against instead of a separate "no menu yet" UI state to build and test.
/// This get-or-create *decision* lives here, not in `MenuRepository` — see
/// that interface's own doc for why the two operations stay separate there.
///
/// No live-push subscription wiring (unlike `CurrentHouseholdController`'s
/// `watchHouseholdChanges`): W9 has no `onMenuChanged` (deferred,
/// E2E_MVP_PLAN.md §15.2 D1) — [refresh] is called explicitly by whichever
/// screen/controller just mutated the menu (`addMenuItem`/`removeMenuItem`),
/// not by a background push.
class CurrentMenuController extends FamilyAsyncNotifier<Menu, MenuKey> {
  /// `read`, not `watch` — consistent with every other controller in this
  /// codebase.
  MenuRepository get _repository => ref.read(menuRepositoryProvider);

  @override
  Future<Menu> build(MenuKey key) async {
    assert(
      _isCanonicalWeekStartDate(key.weekStartDate),
      'MenuKey.weekStartDate must be UTC midnight — build it via menuKeyFor(), '
      'never a raw record literal (see MenuKey\'s own doc).',
    );

    final Menu? existing = await _repository.fetchMenu(
      key.householdId,
      key.weekStartDate,
    );
    if (existing != null) {
      return existing;
    }
    return _repository.createMenu(key.householdId, key.weekStartDate);
  }

  /// Re-reads the menu from the server.
  ///
  /// **Never throws** — the outcome lands in `state`, matching
  /// `CurrentHouseholdController.refresh`'s identical contract and the same
  /// `copyWithPrevious` reasoning: a failed refresh leaves the last good
  /// week on screen instead of blanking it.
  Future<void> refresh() async {
    final AsyncValue<Menu> previous = state;
    state = const AsyncLoading<Menu>().copyWithPrevious(previous);

    final AsyncValue<Menu> result = await AsyncValue.guard<Menu>(
      () async =>
          await _repository.fetchMenu(arg.householdId, arg.weekStartDate) ??
          _repository.createMenu(arg.householdId, arg.weekStartDate),
    );

    state = result.hasError ? result.copyWithPrevious(previous) : result;
  }

  /// Places [draft] on the current menu, then [refresh]es so the returned
  /// item's own row (and every derived cap the Weekly plan grid computes
  /// client-side for display) reflects the server's new state rather than a
  /// hand-patched local guess.
  ///
  /// **Throws**, unlike [refresh] and unlike this codebase's more common
  /// `AsyncValue.guard`-into-`state` write pattern (`PantryFormController`,
  /// `HouseholdSettingsController`) — a deliberate divergence, not an
  /// oversight: E2E_MVP_PLAN.md §15.3 S4's own RED spec requires "a
  /// server-side cap-rejection surfaces as a typed AppError the controller
  /// can render, not a swallowed failure," and a widget mid-interaction
  /// (placing a recipe into a slot) needs that rejection at the `await`
  /// site to show inline, not buried in a `state.hasError` the grid it's
  /// already looking at may not re-render. A `MenuFormController`-style
  /// wrapper mirroring pantry's own pattern is the natural next step if a
  /// future slice needs both call shapes.
  ///
  /// Also throws if [_repository.addMenuItem] itself succeeds but the
  /// follow-up [refresh] fails — the add is NOT rolled back server-side in
  /// that case (there is nothing to roll back; the mutation already
  /// committed), but the caller must still learn its own view of the menu
  /// is now stale rather than silently returning as if everything is
  /// current.
  Future<void> addMenuItem(NewMenuItem draft) async {
    final Menu menu = await future;
    await _repository.addMenuItem(menu.id, draft);
    await refresh();
    if (state.hasError) {
      // ignore: only_throw_errors
      throw state.error!;
    }
  }

  /// Removes the item with [id] from the current menu, then [refresh]es.
  /// Same throws-on-failure contract as [addMenuItem], including the
  /// succeeded-but-refresh-failed case.
  Future<void> removeMenuItem(String id) async {
    await _repository.removeMenuItem(id);
    await refresh();
    if (state.hasError) {
      // ignore: only_throw_errors
      throw state.error!;
    }
  }
}

final AsyncNotifierProviderFamily<CurrentMenuController, Menu, MenuKey>
currentMenuControllerProvider =
    AsyncNotifierProvider.family<CurrentMenuController, Menu, MenuKey>(
      CurrentMenuController.new,
    );
