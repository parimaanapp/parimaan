import '../../../shared/graphql/operations/__generated__/shopping_list_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/shopping_list_item_fields.data.gql.dart';
import '../domain/shopping_list_item.dart';

/// The boundary where Ferry / `built_value` types become the plain domain
/// [ShoppingList] — same rule and precedent as
/// `features/menu/data/menu_mapper.dart`.
///
/// Takes the **fragment** interface `GShoppingListFields`, not any one
/// operation's own generated element type — `generateShoppingList`,
/// `regenerateShoppingList` and `haveIt` all spread `ShoppingListFields`, so
/// this one mapper serves all three, the same `MenuFields` shape every
/// other multi-operation return type in this codebase uses.
ShoppingList shoppingListFromGraphQL(GShoppingListFields data) => ShoppingList(
  id: data.id,
  householdId: data.householdId,
  generatedFromMenuId: data.generatedFromMenuId,
  createdAt: data.createdAt,
  closedAt: data.closedAt,
  aiStaplesNote: data.aiStaplesNote,
  items: data.items.map(shoppingListItemFromGraphQL).toList(growable: false),
);

/// The `ShoppingListItem` counterpart to [shoppingListFromGraphQL] — also a
/// fragment interface (`ShoppingListItemFields`), shared by
/// `ShoppingList.items` via [shoppingListFromGraphQL].
ShoppingListItem shoppingListItemFromGraphQL(GShoppingListItemFields data) =>
    ShoppingListItem(
      id: data.id,
      name: data.name,
      quantity: data.quantity,
      unit: data.unit,
      category: data.category,
      sourceRecipeId: data.sourceRecipeId,
      purchased: data.purchased,
      purchasedBy: data.purchasedBy,
      purchasedAt: data.purchasedAt,
      movedToPantry: data.movedToPantry,
    );
