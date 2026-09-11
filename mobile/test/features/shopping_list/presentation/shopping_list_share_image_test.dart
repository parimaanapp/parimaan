import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_category_order.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/presentation/shopping_list_share_image.dart';

import '../../../support/shopping_list_fixtures.dart';

/// A second item, in a DIFFERENT category from [testShoppingListItem]
/// ('grains'), so a grouping test actually exercises more than one bucket —
/// same reasoning `checklist_item_test.dart`'s own multi-category fixtures
/// use.
final ShoppingListItem _produceItem = ShoppingListItem(
  id: 'item-2',
  name: 'Tomato',
  quantity: 1,
  unit: 'kg',
  category: 'produce',
  sourceRecipeId: 'recipe-2',
  purchased: false,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
);

/// A third item with no recognised category at all, to exercise the
/// alphabetical-then-`other` tail of [groupShoppingListItemsByCategory].
final ShoppingListItem _uncategorizedItem = ShoppingListItem(
  id: 'item-3',
  name: 'Mystery spice',
  quantity: null,
  unit: null,
  category: null,
  sourceRecipeId: null,
  purchased: false,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
);

final ShoppingList _multiCategoryList = ShoppingList(
  id: 'shopping-list-1',
  householdId: 'household-1',
  generatedFromMenuId: 'menu-1',
  createdAt: DateTime.utc(2026, 9, 1),
  closedAt: null,
  aiStaplesNote: null,
  items: <ShoppingListItem>[
    testShoppingListItem,
    _produceItem,
    _uncategorizedItem,
  ],
);

void main() {
  group('shareImageCategoryGroups', () {
    // W17 S4 RED test #1 (E2E_MVP_PLAN.md §23.3 S4's own RED test list):
    // "the render widget produces the expected category grouping from a
    // fixture shopping list — same grouping order/logic as the existing
    // Shopping List screen, asserted equal, not re-derived." This is not a
    // fresh re-derivation — [shareImageCategoryGroups] literally delegates
    // to [groupShoppingListItemsByCategory], the SAME function
    // `CategorizedChecklist` (the live screen) calls, so this equality can
    // never drift out of sync with what ships behind it.
    test(
      'produces the exact same groups as groupShoppingListItemsByCategory, '
      'in the same stable order, for a multi-category fixture',
      () {
        final List<ShoppingListCategoryGroup> shareGroups =
            shareImageCategoryGroups(_multiCategoryList);
        final List<ShoppingListCategoryGroup> liveScreenGroups =
            groupShoppingListItemsByCategory(_multiCategoryList.toBuy);

        expect(shareGroups.length, liveScreenGroups.length);
        for (int i = 0; i < shareGroups.length; i++) {
          expect(shareGroups[i].category, liveScreenGroups[i].category);
          expect(shareGroups[i].items, liveScreenGroups[i].items);
        }
        // Concretely: 'grain'/'grains' before 'produce'... no — assert the
        // real known order this codebase defines: produce, then the
        // grains-family, then the unknown/other tail.
        expect(shareGroups.map((g) => g.category).toList(), <String>[
          'produce',
          'grains',
          otherShoppingListCategory,
        ]);
      },
    );

    test('an empty toBuy list produces zero groups', () {
      expect(shareImageCategoryGroups(testEmptyShoppingList), isEmpty);
    });
  });
}
