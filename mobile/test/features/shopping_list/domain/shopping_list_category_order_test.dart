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
    test('uses the approved catalog labels (docs/catalog/decisions.md)', () {
      const Map<String, String> expected = <String, String>{
        'dal': 'Dal',
        'grain': 'Grain',
        'grains': 'Grain',
        'spice': 'Spice',
        'dairy': 'Dairy',
        'eggs': 'Eggs',
        'produce': 'Produce',
        'dry_goods': 'Dry Goods',
        'oil': 'Oil',
        'meat_fish': 'Meat & Fish',
        'condiment': 'Condiment',
        'bakery': 'Bakery',
        'snacks': 'Snacks',
        'beverages': 'Beverages',
        'frozen': 'Frozen',
        'other': 'Other',
      };
      expected.forEach((String key, String label) {
        expect(shoppingListCategoryLabel(key), label, reason: key);
      });
    });

    test(
      'an unknown snake_case value falls back to a spaced, capitalised label',
      () {
        expect(shoppingListCategoryLabel('fresh_herbs'), 'Fresh herbs');
        expect(shoppingListCategoryLabel(''), '');
      },
    );
  });

  group('approved categories all have a defined slot', () {
    test('every approved category sorts in its defined order, then unknowns, then other', () {
      final List<String> order = groupShoppingListItemsByCategory(
        <ShoppingListItem>[
          _item('1', 'other'),
          _item('2', 'zzz_unknown'),
          _item('3', 'beverages'),
          _item('4', 'snacks'),
          _item('5', 'bakery'),
          _item('6', 'meat_fish'),
          _item('7', 'oil'),
          _item('8', 'eggs'),
          _item('9', 'spice'),
          _item('10', 'produce'),
        ],
      ).map((ShoppingListCategoryGroup g) => g.category).toList();
      expect(order, <String>[
        'produce',
        'spice',
        'eggs',
        'oil',
        'meat_fish',
        'bakery',
        'snacks',
        'beverages',
        'zzz_unknown',
        'other',
      ]);
    });
  });

  group('category normalisation', () {
    test('grains and grain share one group, keyed "grain"', () {
      final List<ShoppingListCategoryGroup> groups =
          groupShoppingListItemsByCategory(<ShoppingListItem>[
            _item('1', 'grains'),
            _item('2', 'grain'),
          ]);
      expect(groups.length, 1);
      expect(groups.single.category, 'grain');
      expect(groups.single.items.length, 2);
    });

    test('case, whitespace and spaced variants fold into the known value', () {
      final List<ShoppingListCategoryGroup> groups =
          groupShoppingListItemsByCategory(<ShoppingListItem>[
            _item('1', ' Produce '),
            _item('2', 'PRODUCE'),
            _item('3', 'Dry Goods'),
            _item('4', 'dry_goods'),
            _item('5', 'Meat & Fish'),
            _item('6', '   '),
          ]);
      expect(
        groups.map((ShoppingListCategoryGroup g) => g.category).toList(),
        <String>['produce', 'dry_goods', 'meat_fish', 'other'],
      );
      expect(groups.first.items.length, 2);
    });
  });
}
