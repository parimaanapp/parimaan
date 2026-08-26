/// One `PantryItem` node exactly as AppSync serializes the shared
/// `PantryItemFields` fragment — mirrors `household_fixtures.dart`'s
/// `householdWireNode`.
Map<String, dynamic> pantryItemWireNode({
  String id = 'item-1',
  String householdId = 'household-1',
  String name = 'Toor Dal',
  double quantity = 2,
  String unit = 'kg',
  String? category = 'dal',
  bool isStaple = true,
  String? expiryDate,
  double? lowThreshold = 0.5,
  String addedBy = 'user-1',
  String addedAt = '2026-08-25T10:00:00.000Z',
  String updatedAt = '2026-08-25T11:00:00.000Z',
}) => <String, dynamic>{
  '__typename': 'PantryItem',
  'id': id,
  'householdId': householdId,
  'name': name,
  'quantity': quantity,
  'unit': unit,
  'category': category,
  'isStaple': isStaple,
  'expiryDate': expiryDate,
  'lowThreshold': lowThreshold,
  'addedBy': addedBy,
  'addedAt': addedAt,
  'updatedAt': updatedAt,
};

/// `Query.pantry`'s wire response body.
Map<String, dynamic> pantryQueryWireData({
  List<Map<String, dynamic>>? items,
}) => <String, dynamic>{
  'pantry': items ?? <Map<String, dynamic>>[pantryItemWireNode()],
};

/// `Mutation.addPantryItem`'s wire response body.
Map<String, dynamic> addPantryItemWireData({Map<String, dynamic>? item}) =>
    <String, dynamic>{'addPantryItem': item ?? pantryItemWireNode()};

/// `Mutation.updatePantryItem`'s wire response body.
Map<String, dynamic> updatePantryItemWireData({Map<String, dynamic>? item}) =>
    <String, dynamic>{'updatePantryItem': item ?? pantryItemWireNode()};

/// `Mutation.deletePantryItem`'s wire response body.
Map<String, dynamic> deletePantryItemWireData({Map<String, dynamic>? item}) =>
    <String, dynamic>{'deletePantryItem': item ?? pantryItemWireNode()};
