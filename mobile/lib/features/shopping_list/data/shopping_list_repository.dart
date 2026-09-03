import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/ferry_execute.dart';
import '../../../shared/graphql/operations/__generated__/generate_shopping_list.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/generate_shopping_list.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/generate_shopping_list.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/have_it.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/have_it.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/have_it.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/regenerate_shopping_list.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/regenerate_shopping_list.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/regenerate_shopping_list.var.gql.dart';
import '../domain/shopping_list_item.dart';
import 'shopping_list_mapper.dart';

/// The app's shopping-list surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of `AppError` and
/// nothing else — same contract as `MenuRepository`'s.
///
/// A straight structural mirror of `MenuRepository` (E2E_MVP_PLAN.md §17.3
/// S5). Unlike `MenuRepository`, there is no `Query.shoppingList` this week
/// (`shared/schema.graphql` defines no such field) — every method here is a
/// mutation; a screen learns the current list only from the response of
/// whichever of these three it last called, never from a separate fetch.
abstract interface class ShoppingListRepository {
  /// Generates [menuId]'s shopping list — aggregates every non-staple
  /// ingredient across the menu, subtracts current pantry stock, and writes
  /// the result as a fresh `ShoppingList`.
  ///
  /// Refuses a second call while an OPEN list already exists for [menuId]
  /// (`ConflictError`) — [regenerateShoppingList] is the only method that
  /// may write to an existing list.
  Future<ShoppingList> generateShoppingList(String menuId);

  /// Regenerates [menuId]'s shopping list via D8's merge-regenerate design
  /// (E2E_MVP_PLAN.md §17.2.8): every already-had or manually-added item is
  /// preserved untouched; only the remaining auto-generated, not-yet-had
  /// portion is recomputed against current menu/pantry state.
  ///
  /// [confirmed] `false` (or when no open list exists yet) previews exactly
  /// what WOULD change — an unpersisted `ShoppingList` a caller can render
  /// real "N kept, M recomputed" confirm-dialog copy from — without writing
  /// anything. [confirmed] `true` commits the merge. Server-enforced, never
  /// a client-only confirm dialog.
  Future<ShoppingList> regenerateShoppingList(
    String menuId, {
    required bool confirmed,
  });

  /// Marks the `ShoppingListItem` with [itemId] as bought and moves it into
  /// the household's pantry in one transaction (SD §5.7, W11 S3). [quantity]
  /// must be strictly positive.
  ///
  /// Returns the item's full parent `ShoppingList`, not just the one item —
  /// same D1 return-type widening the server made. A second call on an
  /// already-`purchased` item is rejected with `ConflictError`.
  Future<ShoppingList> haveIt(String itemId, double quantity);
}

/// Ferry-backed [ShoppingListRepository].
class FerryShoppingListRepository
    with FerryExecuteMixin
    implements ShoppingListRepository {
  const FerryShoppingListRepository({required this.client});

  @override
  final Client client;

  @override
  Future<ShoppingList> generateShoppingList(String menuId) async {
    final GGenerateShoppingListReq request = GGenerateShoppingListReq(
      (GGenerateShoppingListReqBuilder b) =>
          b..vars = (GGenerateShoppingListVarsBuilder()..menuId = menuId),
    );

    final GGenerateShoppingListData data = await execute(request);
    return shoppingListFromGraphQL(data.generateShoppingList);
  }

  @override
  Future<ShoppingList> regenerateShoppingList(
    String menuId, {
    required bool confirmed,
  }) async {
    // Always NoCache — same reasoning as `MenuRepository.autoFillPreview`:
    // a `confirmed: false` call returns an UNPERSISTED preview that reuses
    // the real list's id, and the default cache-writing fetch policy would
    // normalize that preview straight over the last-known-good
    // `ShoppingList:<id>` cache entry. Kept NoCache for `confirmed: true`
    // too, for one uniform policy on this one field rather than a
    // conditional that a future edit could get backwards.
    final GRegenerateShoppingListReq request = GRegenerateShoppingListReq(
      (GRegenerateShoppingListReqBuilder b) => b
        ..vars = (GRegenerateShoppingListVarsBuilder()
          ..menuId = menuId
          ..confirmed = confirmed)
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GRegenerateShoppingListData data = await execute(request);
    return shoppingListFromGraphQL(data.regenerateShoppingList);
  }

  @override
  Future<ShoppingList> haveIt(String itemId, double quantity) async {
    final GHaveItReq request = GHaveItReq(
      (GHaveItReqBuilder b) => b
        ..vars = (GHaveItVarsBuilder()
          ..itemId = itemId
          ..quantity = quantity),
    );

    final GHaveItData data = await execute(request);
    return shoppingListFromGraphQL(data.haveIt);
  }
}

/// Injection point for [ShoppingListRepository] — same default-to-real-Ferry-impl
/// shape as `menuRepositoryProvider`.
final Provider<ShoppingListRepository> shoppingListRepositoryProvider =
    Provider<ShoppingListRepository>(
      (Ref ref) =>
          FerryShoppingListRepository(client: ref.watch(ferryClientProvider)),
    );
