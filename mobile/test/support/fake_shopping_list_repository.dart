import 'dart:async';

import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';

/// Hand-written [ShoppingListRepository] double — same rationale and shape
/// as `FakeMenuRepository`: one `xResult`/`xError` pair and one call log per
/// method, [error] taking precedence over [result] everywhere.
class FakeShoppingListRepository implements ShoppingListRepository {
  FakeShoppingListRepository({
    this.generateResult,
    this.generateError,
    this.regenerateResult,
    this.regenerateError,
    this.haveItResult,
    this.haveItError,
    this.markPurchasedResult,
    this.markPurchasedError,
    this.delay,
  });

  /// Optional artificial latency applied to every method, for asserting a
  /// loading state.
  Duration? delay;

  // ── generateShoppingList ──────────────────────────────────────────────

  ShoppingList? generateResult;
  Object? generateError;
  final List<String> generateCalls = <String>[];

  // ── regenerateShoppingList ────────────────────────────────────────────

  ShoppingList? regenerateResult;
  Object? regenerateError;
  final List<(String menuId, bool confirmed)> regenerateCalls =
      <(String, bool)>[];

  // ── haveIt ───────────────────────────────────────────────────────────

  ShoppingList? haveItResult;
  Object? haveItError;
  final List<(String itemId, double quantity)> haveItCalls =
      <(String, double)>[];

  // ── markPurchased ────────────────────────────────────────────────────

  ShoppingList? markPurchasedResult;
  Object? markPurchasedError;
  final List<String> markPurchasedCalls = <String>[];

  // ── watchShoppingListChanges ────────────────────────────────────────

  /// One controller per `householdId` a test has called
  /// [watchShoppingListChanges] for, so a test can `.add(shoppingList)`/
  /// `.addError(...)` to simulate a live-update push without any real
  /// subscription transport — same shape as `FakePantryRepository.
  /// watchControllers`. Never emits on its own.
  final Map<String, StreamController<ShoppingList>> watchControllers =
      <String, StreamController<ShoppingList>>{};

  /// Every `householdId` [watchShoppingListChanges] was called with, in
  /// order.
  final List<String> watchCalls = <String>[];

  @override
  Future<ShoppingList> generateShoppingList(String menuId) async {
    generateCalls.add(menuId);
    if (delay != null) await Future<void>.delayed(delay!);
    if (generateError != null) throw generateError!;
    final ShoppingList? result = generateResult;
    if (result == null) {
      throw StateError(
        'FakeShoppingListRepository.generateShoppingList: no generateResult configured.',
      );
    }
    return result;
  }

  @override
  Future<ShoppingList> regenerateShoppingList(
    String menuId, {
    required bool confirmed,
  }) async {
    regenerateCalls.add((menuId, confirmed));
    if (delay != null) await Future<void>.delayed(delay!);
    if (regenerateError != null) throw regenerateError!;
    final ShoppingList? result = regenerateResult;
    if (result == null) {
      throw StateError(
        'FakeShoppingListRepository.regenerateShoppingList: no regenerateResult configured.',
      );
    }
    return result;
  }

  @override
  Future<ShoppingList> haveIt(String itemId, double quantity) async {
    haveItCalls.add((itemId, quantity));
    if (delay != null) await Future<void>.delayed(delay!);
    if (haveItError != null) throw haveItError!;
    final ShoppingList? result = haveItResult;
    if (result == null) {
      throw StateError(
        'FakeShoppingListRepository.haveIt: no haveItResult configured.',
      );
    }
    return result;
  }

  @override
  Future<ShoppingList> markPurchased(String itemId) async {
    markPurchasedCalls.add(itemId);
    if (delay != null) await Future<void>.delayed(delay!);
    if (markPurchasedError != null) throw markPurchasedError!;
    final ShoppingList? result = markPurchasedResult;
    if (result == null) {
      throw StateError(
        'FakeShoppingListRepository.markPurchased: no markPurchasedResult configured.',
      );
    }
    return result;
  }

  @override
  Stream<ShoppingList> watchShoppingListChanges(String householdId) {
    watchCalls.add(householdId);
    return watchControllers
        .putIfAbsent(
          householdId,
          () => StreamController<ShoppingList>.broadcast(),
        )
        .stream;
  }
}
