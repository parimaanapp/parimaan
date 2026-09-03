import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_category_order.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';

ShoppingListItem _item(String id, String? category) => ShoppingListItem(
  id: id,
  name: 'item-$id',
  quantity: 1,
  unit: 'piece',
  category: category,
  sourceRecipeId: 'recipe-1',
  purchased: false,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
);

void main() {
  group('groupShoppingListItemsByCategory — stable, defined order', () {
    test(
      'known categories render in the defined order, regardless of input order',
      () {
        final List<ShoppingListItem> items = <ShoppingListItem>[
          _item('1', 'frozen'),
          _item('2', 'produce'),
          _item('3', 'dairy'),
        ];

        final List<ShoppingListCategoryGroup> grouped =
            groupShoppingListItemsByCategory(items);

        expect(
          grouped.map((ShoppingListCategoryGroup g) => g.category).toList(),
          <String>['produce', 'dairy', 'frozen'],
        );
      },
    );

    test('the same items in a different input order produce the identical group order', () {
      final List<ShoppingListItem> forward = <ShoppingListItem>[
        _item('1', 'produce'),
        _item('2', 'dairy'),
      ];
      final List<ShoppingListItem> reversed = forward.reversed.toList();

      final List<String> forwardOrder = groupShoppingListItemsByCategory(
        forward,
      ).map((ShoppingListCategoryGroup g) => g.category).toList();
      final List<String> reversedOrder = groupShoppingListItemsByCategory(
        reversed,
      ).map((ShoppingListCategoryGroup g) => g.category).toList();

      expect(forwardOrder, reversedOrder);
    });

    test('an unrecognised category sorts alphabetically after every known one, before "other"', () {
      final List<ShoppingListItem> items = <ShoppingListItem>[
        _item('1', null),
        _item('2', 'produce'),
        _item('3', 'zzz_unknown'),
        _item('4', 'aaa_unknown'),
      ];

      final List<String> order = groupShoppingListItemsByCategory(items)
          .map((ShoppingListCategoryGroup g) => g.category)
          .toList();

      expect(order, <String>['produce', 'aaa_unknown', 'zzz_unknown', 'other']);
    });

    test('items group correctly per category — every item lands in its own category bucket', () {
      final ShoppingListItem rice = _item('rice', 'grain');
      final ShoppingListItem milk = _item('milk', 'dairy');
      final ShoppingListItem tomato = _item('tomato', 'produce');
      final ShoppingListItem misc = _item('misc', null);

      final List<ShoppingListCategoryGroup> grouped =
          groupShoppingListItemsByCategory(<ShoppingListItem>[
            rice,
            milk,
            tomato,
            misc,
          ]);

      final Map<String, List<ShoppingListItem>> byCategory =
          <String, List<ShoppingListItem>>{
            for (final ShoppingListCategoryGroup g in grouped)
              g.category: g.items,
          };

      expect(byCategory['grain'], <ShoppingListItem>[rice]);
      expect(byCategory['dairy'], <ShoppingListItem>[milk]);
      expect(byCategory['produce'], <ShoppingListItem>[tomato]);
      expect(byCategory['other'], <ShoppingListItem>[misc]);
    });

    test('no items produces no groups', () {
      expect(
        groupShoppingListItemsByCategory(const <ShoppingListItem>[]),
        isEmpty,
      );
    });
  });

  group('shoppingListCategoryLabel', () {
    test('formats snake_case as a capitalized, spaced label', () {
      expect(shoppingListCategoryLabel('dry_goods'), 'Dry goods');
      expect(shoppingListCategoryLabel('other'), 'Other');
    });
  });
}
