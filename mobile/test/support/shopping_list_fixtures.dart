import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';

/// A domain [ShoppingListItem], for tests that need one without a wire
/// round trip.
final ShoppingListItem testShoppingListItem = ShoppingListItem(
  id: 'item-1',
  name: 'Rice',
  quantity: 2,
  unit: 'kg',
  category: 'grains',
  sourceRecipeId: 'recipe-1',
  purchased: false,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
);

/// The same item as [testShoppingListItem], but already `haveIt`-marked —
/// `purchased`/`purchasedBy`/`purchasedAt`/`movedToPantry` all set together,
/// per `Mutation.haveIt`'s own atomic-write doc.
final ShoppingListItem testPurchasedShoppingListItem = ShoppingListItem(
  id: 'item-1',
  name: 'Rice',
  quantity: 2,
  unit: 'kg',
  category: 'grains',
  sourceRecipeId: 'recipe-1',
  purchased: true,
  purchasedBy: 'user-1',
  purchasedAt: DateTime.utc(2026, 9, 3, 12),
  movedToPantry: true,
);

/// A domain [ShoppingList] with one not-yet-purchased item, for tests that
/// need a non-empty list.
final ShoppingList testShoppingList = ShoppingList(
  id: 'shopping-list-1',
  householdId: 'household-1',
  generatedFromMenuId: 'menu-1',
  createdAt: DateTime.utc(2026, 9, 1),
  closedAt: null,
  aiStaplesNote: null,
  items: <ShoppingListItem>[testShoppingListItem],
);

/// A domain [ShoppingList] with zero items — the "every ingredient was
/// staple-excluded" or "empty menu" case, never an error
/// (`Mutation.generateShoppingList`'s own doc).
final ShoppingList testEmptyShoppingList = ShoppingList(
  id: 'shopping-list-1',
  householdId: 'household-1',
  generatedFromMenuId: 'menu-1',
  createdAt: DateTime.utc(2026, 9, 1),
  closedAt: null,
  aiStaplesNote: null,
  items: const <ShoppingListItem>[],
);

/// The exact JSON AppSync returns for the shared `ShoppingListItemFields`
/// fragment.
Map<String, dynamic> shoppingListItemWireNode({
  String id = 'item-1',
  String name = 'Rice',
  double? quantity = 2,
  String? unit = 'kg',
  String? category = 'grains',
  String? sourceRecipeId = 'recipe-1',
  bool purchased = false,
  String? purchasedBy,
  String? purchasedAt,
  bool movedToPantry = false,
}) => <String, dynamic>{
  '__typename': 'ShoppingListItem',
  'id': id,
  'name': name,
  'quantity': quantity,
  'unit': unit,
  'category': category,
  'sourceRecipeId': sourceRecipeId,
  'purchased': purchased,
  'purchasedBy': purchasedBy,
  'purchasedAt': purchasedAt,
  'movedToPantry': movedToPantry,
};

/// The exact JSON AppSync returns for the shared `ShoppingListFields`
/// fragment.
Map<String, dynamic> shoppingListWireNode({
  String id = 'shopping-list-1',
  String householdId = 'household-1',
  String? generatedFromMenuId = 'menu-1',
  String createdAt = '2026-09-01T00:00:00.000Z',
  String? closedAt,
  String? aiStaplesNote,
  List<Map<String, dynamic>>? items,
}) => <String, dynamic>{
  '__typename': 'ShoppingList',
  'id': id,
  'householdId': householdId,
  'generatedFromMenuId': generatedFromMenuId,
  'createdAt': createdAt,
  'closedAt': closedAt,
  'aiStaplesNote': aiStaplesNote,
  'items': items ?? <Map<String, dynamic>>[],
};

Map<String, dynamic> generateShoppingListWireData({
  Map<String, dynamic>? shoppingList,
}) => <String, dynamic>{
  'generateShoppingList': shoppingList ?? shoppingListWireNode(),
};

Map<String, dynamic> regenerateShoppingListWireData({
  Map<String, dynamic>? shoppingList,
}) => <String, dynamic>{
  'regenerateShoppingList': shoppingList ?? shoppingListWireNode(),
};

Map<String, dynamic> haveItWireData({Map<String, dynamic>? shoppingList}) =>
    <String, dynamic>{'haveIt': shoppingList ?? shoppingListWireNode()};
