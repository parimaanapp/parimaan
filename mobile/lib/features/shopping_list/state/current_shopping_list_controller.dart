import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/shopping_list_repository.dart';
import '../domain/shopping_list_item.dart';

/// The server-backed shopping list for one menu, keyed by `menuId` — a
/// *family*, mirroring `CurrentMenuController`'s own keying reasoning
/// (E2E_MVP_PLAN.md §17.3 S5). A plain `menuId` string is enough here, unlike
/// `CurrentMenuController`'s compound `MenuKey`: a shopping list is already
/// scoped to one menu (which is itself scoped to one household+week), so
/// there is no second axis to key on.
///
/// **`build` does not fetch-then-fall-back the way `CurrentMenuController.build`
/// does** — there is no `Query.shoppingList` this week
/// (`shared/schema.graphql` defines none), so there is nothing to fetch.
/// `build` calls [ShoppingListRepository.generateShoppingList] directly: the
/// first time a screen watches this provider for a given `menuId` is exactly
/// the "Generate shopping list" affordance (S6) being used for the first
/// time on that menu. A second, independent attempt to generate for the
/// same `menuId` (this controller rebuilt, e.g. after a hot restart) is
/// refused server-side with a `ConflictError` — same as a direct repeat call
/// to `generateShoppingList` — since [regenerateShoppingList] is the only
/// method allowed to write to an existing list. [recoverFromConflict] below
/// is this week's stopgap for that exact case (W11 S6b) — it reaches
/// `regenerateShoppingList` without depending on this stuck `build()`'s own
/// `future` — but it is still a stopgap: a real, first-class re-entry still
/// belongs to a later slice, once a real `Query.shoppingList` exists.
class CurrentShoppingListController
    extends FamilyAsyncNotifier<ShoppingList, String> {
  /// `read`, not `watch` — consistent with every other controller in this
  /// codebase.
  ShoppingListRepository get _repository =>
      ref.read(shoppingListRepositoryProvider);

  /// Not `late final` — same reasoning as `PantryController.
  /// _changeSubscription`: `build()` can run more than once on the same
  /// notifier instance (e.g. `ref.invalidate`), and a second assignment to
  /// a `late final` field would throw.
  StreamSubscription<ShoppingList>? _changeSubscription;

  @override
  Future<ShoppingList> build(String menuId) async {
    final ShoppingList result = await _repository.generateShoppingList(menuId);

    // Live updates (D1, E2E_MVP_PLAN.md §18.2.1, W12 S3/S4) — subscribed
    // only once [result]'s own `householdId` is known (this field isn't
    // part of the family key, unlike `PantryController`'s), and cancelled
    // on dispose — this family provider's version of "subscribe-on-
    // foreground / unsubscribe-on-background", the identical
    // `PantryController._changeSubscription` pattern. Not reached if
    // `generateShoppingList` itself throws (e.g. `ConflictError` when an
    // open list already exists) — `recoverFromConflict` is the documented
    // stopgap for that case and does not re-run `build()`.
    unawaited(_changeSubscription?.cancel());
    _changeSubscription = _repository
        .watchShoppingListChanges(result.householdId)
        .listen(
          (ShoppingList pushed) => state = AsyncData<ShoppingList>(pushed),
          onError: (Object _) {},
        );
    ref.onDispose(() => unawaited(_changeSubscription?.cancel()));

    return result;
  }

  /// Regenerates the current menu's shopping list via D8's
  /// merge-regenerate design (E2E_MVP_PLAN.md §17.2.8).
  ///
  /// [confirmed] `false` returns the server's preview — real "N kept, M
  /// recomputed" counts a confirm dialog can render — **without** touching
  /// `state`: the preview is not yet committed, so this controller's own
  /// notion of the current list must not change until a caller comes back
  /// with `confirmed: true`. [confirmed] `true` commits the merge and sets
  /// `state` directly from the response, the same "response IS the new
  /// authoritative state, no extra refresh round trip" pattern
  /// `CurrentMenuController.commitAutoFill` uses.
  ///
  /// **Throws** on failure, same contract as every mutating method on
  /// `CurrentMenuController` — a widget mid-interaction (the Regenerate
  /// confirm dialog) needs the rejection at the `await` site. `state` is
  /// left unchanged on failure — nothing here is written until the call
  /// itself succeeds.
  Future<ShoppingList> regenerateShoppingList({required bool confirmed}) async {
    // Waited for, but its value is discarded — `arg` alone (the family key)
    // is enough to call `regenerateShoppingList`. This exists purely as a
    // completion guard: it ensures the controller's own `build()` (the
    // initial `generateShoppingList` call) has settled before this method
    // touches `state`, the same guard `haveIt` takes below.
    await future;
    final ShoppingList result = await _repository.regenerateShoppingList(
      arg,
      confirmed: confirmed,
    );
    if (confirmed) {
      state = AsyncData<ShoppingList>(result);
    }
    return result;
  }

  /// Recovers this controller from the `ConflictError` `build()` throws when
  /// an open list already exists for [arg] (this controller's own class
  /// doc) — the ONE caller allowed to reach [ShoppingListRepository.
  /// regenerateShoppingList] WITHOUT first awaiting a successfully-resolved
  /// `future`. [regenerateShoppingList] above starts with `await future` on
  /// purpose (its own doc: a completion guard against racing an in-flight
  /// `build()`), but here `future` IS the already-failed `build()` this
  /// method exists to route around — awaiting it would just re-throw the
  /// identical `ConflictError` (`ShoppingListScreen`'s own doc names this
  /// exact trap). Deliberately a SEPARATE method rather than a parameter on
  /// [regenerateShoppingList]: every other, non-conflict caller legitimately
  /// wants that guard, and skipping it unconditionally would let a call
  /// race an in-flight FIRST-time `build()` and clobber `state` once that
  /// build later resolves — the same hazard [haveIt]'s own doc names for
  /// itself.
  ///
  /// Same [confirmed] contract as [regenerateShoppingList]: `false` returns
  /// an unpersisted preview without touching `state`; `true` commits and
  /// sets `state` from the response. Throws on failure, `state` left
  /// unchanged — same contract as every other mutating method here.
  Future<ShoppingList> recoverFromConflict({required bool confirmed}) async {
    final ShoppingList result = await _repository.regenerateShoppingList(
      arg,
      confirmed: confirmed,
    );
    if (confirmed) {
      state = AsyncData<ShoppingList>(result);
    }
    return result;
  }

  /// Marks the `ShoppingListItem` with [itemId] as bought and moves it into
  /// the household's pantry (W11 S3), then sets `state` directly from the
  /// response's own full `ShoppingList` — same no-extra-refresh reasoning as
  /// [regenerateShoppingList]'s `confirmed: true` branch. An item this
  /// mutation just marked `purchased` drops out of
  /// [ShoppingList.toBuy], which is what a "moved to pantry" swipe
  /// (S7) actually renders disappearing.
  ///
  /// **Throws** on failure, same contract as every other mutating method
  /// here. `state` is left unchanged on failure.
  Future<ShoppingList> haveIt(String itemId, double quantity) async {
    // Same completion guard as `regenerateShoppingList` — see its own doc.
    // Without it, a `haveIt` call racing an in-flight `build()` could have
    // its `state` write silently clobbered once that `build()` future
    // resolves and Riverpod re-assigns `state` from it.
    await future;
    final ShoppingList result = await _repository.haveIt(itemId, quantity);
    state = AsyncData<ShoppingList>(result);
    return result;
  }

  /// Marks the `ShoppingListItem` with [itemId] as bought (D5/D6,
  /// E2E_MVP_PLAN.md §18.2.5/§18.2.6, W12 S3) and moves it into the
  /// household's pantry, then sets `state` directly from the response's
  /// own full `ShoppingList` — same no-extra-refresh reasoning as [haveIt].
  /// An item this mutation just marked `purchased` drops out of
  /// [ShoppingList.toBuy], the identical getter [haveIt] already relies on
  /// — zero new filtering logic.
  ///
  /// **Throws** on failure, same contract as [haveIt]. `state` is left
  /// unchanged on failure.
  Future<ShoppingList> markPurchased(String itemId) async {
    // Same completion guard as `haveIt` — see its own doc.
    await future;
    final ShoppingList result = await _repository.markPurchased(itemId);
    state = AsyncData<ShoppingList>(result);
    return result;
  }
}

final AsyncNotifierProviderFamily<
  CurrentShoppingListController,
  ShoppingList,
  String
>
currentShoppingListControllerProvider =
    AsyncNotifierProvider.family<
      CurrentShoppingListController,
      ShoppingList,
      String
    >(CurrentShoppingListController.new);
