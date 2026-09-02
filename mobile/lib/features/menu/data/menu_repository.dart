import 'package:built_collection/built_collection.dart';
import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/ferry_execute.dart';
import '../../../shared/graphql/operations/__generated__/add_menu_item.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/add_menu_item.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/add_menu_item.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/auto_fill_preview.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/auto_fill_preview.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/auto_fill_preview.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/auto_fill_week.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/auto_fill_week.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/auto_fill_week.var.gql.dart';
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

  /// Proposes recipes for every currently-empty slot on [menuId]'s menu —
  /// a pure read, writes NOTHING (W10 §16.2.1, D3 — a deliberate dry-run
  /// deviation from a single write-and-return mutation). Safe to call
  /// repeatedly for a free "regenerate": each call is an
  /// independently-random proposal, never the same twice (D11).
  ///
  /// **Always goes to the network**, never ferry's cache — same
  /// `FetchPolicy.NoCache` reasoning as [fetchMenu]: a proposal that's
  /// silently served stale would defeat the whole point of "regenerate."
  Future<AutoFillPreviewResult> autoFillPreview(String menuId);

  /// Commits [items] (typically an accepted or edited [autoFillPreview]
  /// proposal) to [menuId]'s menu. [overwrite] `true` deletes every
  /// existing item without a `madeAt` set first — an item the household
  /// already cooked is never deleted regardless of [overwrite].
  ///
  /// Every item in [items] is re-validated against LIVE server state
  /// rather than trusted from wherever it came from — one that no longer
  /// fits is silently skipped, not an error (best-effort partial commit);
  /// [AutoFillResult.filledCount]/`unfilledSlots` report exactly what
  /// happened, which can legitimately differ from what a prior
  /// [autoFillPreview] call promised.
  Future<AutoFillResult> autoFillWeek(
    String menuId, {
    required bool overwrite,
    required List<NewMenuItem> items,
  });
}

/// Ferry-backed [MenuRepository].
class FerryMenuRepository with FerryExecuteMixin implements MenuRepository {
  const FerryMenuRepository({required this.client});

  @override
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

    final GMenuData data = await execute(request);
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

    final GCreateMenuData data = await execute(request);
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

    final GAddMenuItemData data = await execute(request);
    return menuItemFromGraphQL(data.addMenuItem);
  }

  @override
  Future<bool> removeMenuItem(String id) async {
    final GRemoveMenuItemReq request = GRemoveMenuItemReq(
      (GRemoveMenuItemReqBuilder b) =>
          b..vars = (GRemoveMenuItemVarsBuilder()..id = id),
    );

    final GRemoveMenuItemData data = await execute(request);
    return data.removeMenuItem;
  }

  @override
  Future<AutoFillPreviewResult> autoFillPreview(String menuId) async {
    final GAutoFillPreviewReq request = GAutoFillPreviewReq(
      (GAutoFillPreviewReqBuilder b) => b
        ..vars = (GAutoFillPreviewVarsBuilder()..menuId = menuId)
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GAutoFillPreviewData data = await execute(request);
    return AutoFillPreviewResult(
      items: data.autoFillPreview.items
          .map(proposedMenuItemFromGraphQL)
          .toList(growable: false),
      filledCount: data.autoFillPreview.filledCount,
      unfilledSlots: data.autoFillPreview.unfilledSlots
          .map(unfilledSlotFromGraphQL)
          .toList(growable: false),
    );
  }

  @override
  Future<AutoFillResult> autoFillWeek(
    String menuId, {
    required bool overwrite,
    required List<NewMenuItem> items,
  }) async {
    final GAutoFillWeekReq request = GAutoFillWeekReq(
      (GAutoFillWeekReqBuilder b) => b
        ..vars = (GAutoFillWeekVarsBuilder()
          ..menuId = menuId
          ..overwrite = overwrite
          ..items = ListBuilder<GMenuItemInput>(
            items.map(menuItemInputToGraphQL),
          )),
    );

    final GAutoFillWeekData data = await execute(request);
    return AutoFillResult(
      menu: menuFromGraphQL(data.autoFillWeek.menu),
      filledCount: data.autoFillWeek.filledCount,
      unfilledSlots: data.autoFillWeek.unfilledSlots
          .map(unfilledSlotFromGraphQL)
          .toList(growable: false),
    );
  }

}

/// Injection point for [MenuRepository] — same default-to-real-Ferry-impl
/// shape as `householdRepositoryProvider`.
final Provider<MenuRepository> menuRepositoryProvider =
    Provider<MenuRepository>(
      (Ref ref) => FerryMenuRepository(client: ref.watch(ferryClientProvider)),
    );
