import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';

import '../../../support/shopping_list_fixtures.dart';

void main() {
  group('ShoppingList equality', () {
    test('two ShoppingLists with the same id are equal even with different item lists — id-based, not field-based', () {
      final ShoppingList a = testShoppingList;
      final ShoppingList b = ShoppingList(
        id: testShoppingList.id,
        householdId: 'a-different-household',
        generatedFromMenuId: null,
        createdAt: DateTime.utc(2000),
        closedAt: null,
        aiStaplesNote: null,
        items: const <ShoppingListItem>[],
      );

      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test(
      'a differing id breaks equality even with otherwise-identical fields',
      () {
        final ShoppingList a = testEmptyShoppingList;
        final ShoppingList b = ShoppingList(
          id: 'a-different-id',
          householdId: a.householdId,
          generatedFromMenuId: a.generatedFromMenuId,
          createdAt: a.createdAt,
          closedAt: a.closedAt,
          aiStaplesNote: a.aiStaplesNote,
          items: a.items,
        );

        expect(a, isNot(b));
      },
    );
  });

  group('ShoppingListItem equality', () {
    test('two ShoppingListItems with the same id are equal even with different purchased state — id-based, not field-based', () {
      expect(testShoppingListItem.id, testPurchasedShoppingListItem.id);
      expect(testShoppingListItem, testPurchasedShoppingListItem);
      expect(
        testShoppingListItem.hashCode,
        testPurchasedShoppingListItem.hashCode,
      );
    });

    test(
      'a differing id breaks equality even with otherwise-identical fields',
      () {
        final ShoppingListItem a = testShoppingListItem;
        final ShoppingListItem b = ShoppingListItem(
          id: 'a-different-id',
          name: a.name,
          quantity: a.quantity,
          unit: a.unit,
          category: a.category,
          sourceRecipeId: a.sourceRecipeId,
          purchased: a.purchased,
          purchasedBy: a.purchasedBy,
          purchasedAt: a.purchasedAt,
          movedToPantry: a.movedToPantry,
        );

        expect(a, isNot(b));
      },
    );
  });

  group('ShoppingList.toBuy', () {
    test('excludes purchased items, keeps not-yet-purchased ones', () {
      final ShoppingList list = ShoppingList(
        id: 'shopping-list-1',
        householdId: 'household-1',
        generatedFromMenuId: 'menu-1',
        createdAt: DateTime.utc(2026, 9, 1),
        closedAt: null,
        aiStaplesNote: null,
        items: <ShoppingListItem>[
          testShoppingListItem,
          ShoppingListItem(
            id: 'item-2',
            name: 'Dal',
            quantity: 1,
            unit: 'kg',
            category: 'pulses',
            sourceRecipeId: 'recipe-2',
            purchased: true,
            purchasedBy: 'user-1',
            purchasedAt: DateTime.utc(2026, 9, 2),
            movedToPantry: true,
          ),
        ],
      );

      expect(list.toBuy, <ShoppingListItem>[testShoppingListItem]);
    });

    test('an empty list has an empty toBuy — never an error', () {
      expect(testEmptyShoppingList.toBuy, isEmpty);
    });
  });
}
