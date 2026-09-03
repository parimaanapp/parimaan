/// The app's own shopping-list types, independent of GraphQL and of
/// `built_value` — same boundary rule as `features/menu/domain/menu.dart`.
/// Nothing generated appears here; the mapping from the generated types
/// lives in `../data/shopping_list_mapper.dart`.
library;

/// A household's generated shopping list for one week's `Menu` (W11 S1/S2,
/// E2E_MVP_PLAN.md §17). Mirrors `shared/schema.graphql`'s `ShoppingList`
/// field-for-field. `closedAt`/`aiStaplesNote` are always `null` for
/// everything this week's mutations write (list closure and the W15 AI
/// staples note both land in a future week) — carried here anyway so this
/// type never needs rework once they do.
class ShoppingList {
  const ShoppingList({
    required this.id,
    required this.householdId,
    required this.generatedFromMenuId,
    required this.createdAt,
    required this.closedAt,
    required this.aiStaplesNote,
    required this.items,
  });

  final String id;
  final String householdId;
  final String? generatedFromMenuId;
  final DateTime createdAt;
  final DateTime? closedAt;
  final String? aiStaplesNote;
  final List<ShoppingListItem> items;

  /// The items still to buy — every item [ShoppingListItem.purchased] hasn't
  /// yet flipped `true` on. The "to buy" view the Shopping List screen (S6)
  /// renders; a [ShoppingListItem.haveIt]-derived response never puts an item
  /// back in this list once `purchased` is `true` (`haveIt`'s own
  /// idempotency doc — a second `haveIt` call on the same item is a
  /// `CONFLICT`, never reversible client-side).
  List<ShoppingListItem> get toBuy => items
      .where((ShoppingListItem item) => !item.purchased)
      .toList(growable: false);

  @override
  String toString() => 'ShoppingList(id: $id, items: ${items.length})';

  /// Id-based equality, matching this codebase's own convention for a
  /// server-response type that carries a real id — same rule
  /// `features/menu/domain/menu.dart`'s `Menu` applies.
  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is ShoppingList && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// One line on a [ShoppingList] — either auto-generated from a recipe's
/// ingredients ([sourceRecipeId] non-null) or manually added
/// ([sourceRecipeId] `null`, reserved for a future `addShoppingListItem`,
/// not built this week). Mirrors `shared/schema.graphql`'s
/// `ShoppingListItem` field-for-field. The data model the future
/// `ChecklistItem` UI widget (§4's own named deliverable, built in S6 under
/// `lib/shared/ui/`) renders one row from.
class ShoppingListItem {
  const ShoppingListItem({
    required this.id,
    required this.name,
    required this.quantity,
    required this.unit,
    required this.category,
    required this.sourceRecipeId,
    required this.purchased,
    required this.purchasedBy,
    required this.purchasedAt,
    required this.movedToPantry,
  });

  final String id;
  final String name;
  final double? quantity;
  final String? unit;
  final String? category;
  final String? sourceRecipeId;

  /// Set together, atomically, by `Mutation.haveIt` (W11 S3) — always
  /// `false` for everything `generateShoppingList`/`regenerateShoppingList`
  /// write, and never `false` again once `haveIt` has marked an item (see
  /// `Mutation.haveIt`'s own `CONFLICT` doc).
  final bool purchased;
  final String? purchasedBy;
  final DateTime? purchasedAt;
  final bool movedToPantry;

  @override
  String toString() =>
      'ShoppingListItem(id: $id, name: $name, purchased: $purchased)';

  /// Id-based equality — same rule as [ShoppingList.==] and
  /// `features/menu/domain/menu.dart`'s `MenuItem`.
  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is ShoppingListItem && other.id == id;

  @override
  int get hashCode => id.hashCode;
}
