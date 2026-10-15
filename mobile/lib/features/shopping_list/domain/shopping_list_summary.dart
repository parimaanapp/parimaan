import 'shopping_list_item.dart';

/// How many distinct source recipes feed [items]. Items with no
/// `sourceRecipeId` (free-text adds, aggregated staples) are not counted.
int shoppingListSourceRecipeCount(List<ShoppingListItem> items) => items
    .map((ShoppingListItem item) => item.sourceRecipeId)
    .whereType<String>()
    .toSet()
    .length;

/// `"22 items · from 18 recipes"` (wireframe 10.1's header line). The source
/// part is dropped when no item names a recipe, and both nouns agree with
/// their count.
///
/// The wireframe says "meals"; the list only knows its source recipes (one
/// recipe can fill several meals), so this reports recipes rather than
/// over-claim a meal count the list does not carry.
String shoppingListSummary(List<ShoppingListItem> items) {
  final int count = items.length;
  final String itemsPart = '$count ${count == 1 ? 'item' : 'items'}';
  final int recipes = shoppingListSourceRecipeCount(items);
  if (recipes == 0) return itemsPart;
  return '$itemsPart · from $recipes ${recipes == 1 ? 'recipe' : 'recipes'}';
}
