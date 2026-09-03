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
/// method allowed to write to an existing list; a future screen that needs
/// to re-enter an already-generated list without re-calling `generate`
/// belongs to a later slice, once a real `Query.shoppingList` exists.
class CurrentShoppingListController
    extends FamilyAsyncNotifier<ShoppingList, String> {
  /// `read`, not `watch` — consistent with every other controller in this
  /// codebase.
  ShoppingListRepository get _repository =>
      ref.read(shoppingListRepositoryProvider);

  @override
  Future<ShoppingList> build(String menuId) =>
      _repository.generateShoppingList(menuId);

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
