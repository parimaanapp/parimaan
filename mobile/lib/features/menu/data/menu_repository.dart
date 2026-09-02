import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/add_menu_item.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/add_menu_item.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/add_menu_item.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_menu.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_menu.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/create_menu.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/menu.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/menu.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/menu.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/remove_menu_item.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/remove_menu_item.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/remove_menu_item.var.gql.dart';
import '../domain/menu.dart';
import 'menu_mapper.dart';

/// The app's weekly-menu surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of `AppError` and
/// nothing else — same contract as `HouseholdRepository`'s.
///
/// A straight structural mirror of `HouseholdRepository` (E2E_MVP_PLAN.md
/// §15.3 S4) — [fetchMenu] and [createMenu] are exposed as two separate
/// methods rather than one merged get-or-create, mirroring `Query.menu`/
/// `Mutation.createMenu`'s own separate S2 operations one-to-one; the
/// get-or-create *decision* (call [fetchMenu], fall back to [createMenu] if
/// `null`) belongs to `CurrentMenuController`, not this repository — the
/// same separation `HouseholdRepository.fetchHousehold`/`createHousehold`
/// already keeps.
abstract interface class MenuRepository {
  /// Reads [householdId]'s menu for the week starting [weekStartDate], or
  /// `null` if none has been created yet — never an implicit create.
  ///
  /// **Always goes to the network**, never ferry's cache — same
  /// `FetchPolicy.NoCache` reasoning as `HouseholdRepository.fetchHousehold`
  /// (W9 has no live-push subscription to invalidate a cached read, per
  /// E2E_MVP_PLAN.md §15.2's deferred `onMenuChanged`, so staying uncached is
  /// the only way a re-entry to the Weekly plan screen sees another device's
  /// changes at all).
  ///
  /// A non-member and a nonexistent [householdId] both raise the identical
  /// `ForbiddenError`, so this is never an existence oracle.
  Future<Menu?> fetchMenu(String householdId, DateTime weekStartDate);

  /// Creates [householdId]'s menu for the week starting [weekStartDate], or
  /// returns the existing one if that week already has a menu.
  ///
  /// Idempotent: a repeat call for the same `(householdId, weekStartDate)`
  /// returns the SAME menu, never a `ConflictError`.
  Future<Menu> createMenu(String householdId, DateTime weekStartDate);

  /// Places [draft] into [menuId]'s menu and returns the newly-placed item.
  ///
  /// A server-side cap rejection, a disabled-meal rejection, or a
  /// cross-household `recipeId` all surface as a distinct typed `AppError`
  /// the caller renders — never swallowed (E2E_MVP_PLAN.md §15.3 S3/S4).
  Future<MenuItem> addMenuItem(String menuId, NewMenuItem draft);

  /// Removes the `MenuItem` with [id], freeing its slot.
  ///
  /// Idempotent: a nonexistent or already-removed [id] returns `false`,
  /// never an error — matching `HouseholdRepository.leaveHousehold`'s
  /// precedent, not `PantryRepository.deletePantryItem`'s.
  Future<bool> removeMenuItem(String id);
}

/// Ferry-backed [MenuRepository].
class FerryMenuRepository implements MenuRepository {
  const FerryMenuRepository({required this.client});

  final Client client;

  @override
  Future<Menu?> fetchMenu(String householdId, DateTime weekStartDate) async {
    final GMenuReq request = GMenuReq(
      (GMenuReqBuilder b) => b
        ..vars = (GMenuVarsBuilder()
          ..householdId = householdId
          ..weekStartDate = weekStartDate)
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GMenuData data = await _execute(request);
    final GMenuData_menu? menu = data.menu;
    return menu == null ? null : menuFromGraphQL(menu);
  }

  @override
  Future<Menu> createMenu(String householdId, DateTime weekStartDate) async {
    final GCreateMenuReq request = GCreateMenuReq(
      (GCreateMenuReqBuilder b) => b
        ..vars = (GCreateMenuVarsBuilder()
          ..householdId = householdId
          ..weekStartDate = weekStartDate),
    );

    final GCreateMenuData data = await _execute(request);
    return menuFromGraphQL(data.createMenu);
  }

  @override
  Future<MenuItem> addMenuItem(String menuId, NewMenuItem draft) async {
    final GAddMenuItemReq request = GAddMenuItemReq(
      (GAddMenuItemReqBuilder b) => b
        ..vars = (GAddMenuItemVarsBuilder()
          ..menuId = menuId
          ..input = menuItemInputToGraphQL(draft).toBuilder()),
    );

    final GAddMenuItemData data = await _execute(request);
    return menuItemFromGraphQL(data.addMenuItem);
  }

  @override
  Future<bool> removeMenuItem(String id) async {
    final GRemoveMenuItemReq request = GRemoveMenuItemReq(
      (GRemoveMenuItemReqBuilder b) =>
          b..vars = (GRemoveMenuItemVarsBuilder()..id = id),
    );

    final GRemoveMenuItemData data = await _execute(request);
    return data.removeMenuItem;
  }

  /// See `HouseholdRepository`'s identical `_execute` for the full
  /// rationale — duplicated here rather than shared, matching every other
  /// Ferry-backed repository in this codebase today.
  Future<TData> _execute<TData, TVars>(
    OperationRequest<TData, TVars> request,
  ) async {
    OperationResponse<TData, TVars>? settled;
    await for (final OperationResponse<TData, TVars> response in client.request(
      request,
    )) {
      if (response.data != null || response.hasErrors) {
        settled = response;
        break;
      }
    }

    if (settled == null) {
      throw const InternalError(genericErrorMessage);
    }

    final TData? data = settled.data;
    if (settled.hasErrors || data == null) {
      throw mapOperationFailure(
        graphqlErrors: settled.graphqlErrors,
        linkException: settled.linkException,
      );
    }
    return data;
  }
}

/// Injection point for [MenuRepository] — same default-to-real-Ferry-impl
/// shape as `householdRepositoryProvider`.
final Provider<MenuRepository> menuRepositoryProvider =
    Provider<MenuRepository>(
      (Ref ref) => FerryMenuRepository(client: ref.watch(ferryClientProvider)),
    );
