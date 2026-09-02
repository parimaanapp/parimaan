import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/menu/domain/today.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';

import '../../../support/menu_fixtures.dart';

MenuItem _item(String id, int dayOfWeek, String mealSlot) => MenuItem(
  id: id,
  menuId: 'menu-1',
  recipe: testMenuRecipe,
  dayOfWeek: dayOfWeek,
  mealSlot: mealSlot,
  slotRole: RecipeRole.sabziDal,
);

void main() {
  group('todaysItems', () {
    // Table-driven across all 7 possible "today" values — the same
    // transposition-class rigor E2E_MVP_PLAN.md §15.3 S6's own RED spec
    // requires for a day-of-week calculation, not one day sampled and
    // assumed representative.
    final Map<DateTime, int> todayToDayOfWeek = <DateTime, int>{
      DateTime(2026, 9, 7): 0, // Monday
      DateTime(2026, 9, 8): 1, // Tuesday
      DateTime(2026, 9, 9): 2, // Wednesday
      DateTime(2026, 9, 10): 3, // Thursday
      DateTime(2026, 9, 11): 4, // Friday
      DateTime(2026, 9, 12): 5, // Saturday
      DateTime(2026, 9, 13): 6, // Sunday
    };

    for (final MapEntry<DateTime, int> entry in todayToDayOfWeek.entries) {
      test(
        'for ${entry.key} selects only dayOfWeek ${entry.value}\'s items, not any other day\'s',
        () {
          final Menu menu = Menu(
            id: 'menu-1',
            householdId: 'household-1',
            weekStartDate: DateTime.utc(2026, 9, 7),
            items: <MenuItem>[
              for (int day = 0; day < 7; day++)
                _item('item-$day', day, 'lunch'),
            ],
          );

          final List<MenuItem> result = todaysItems(menu, today: entry.key);

          expect(result, hasLength(1));
          expect(result.single.id, 'item-${entry.value}');
        },
      );
    }

    test('groups today\'s items breakfast → lunch → snacks → dinner, not insertion order', () {
      final Menu menu = Menu(
        id: 'menu-1',
        householdId: 'household-1',
        weekStartDate: DateTime.utc(2026, 9, 7),
        items: <MenuItem>[
          _item('dinner-item', 0, 'dinner'),
          _item('breakfast-item', 0, 'breakfast'),
          _item('snacks-item', 0, 'snacks'),
          _item('lunch-item', 0, 'lunch'),
        ],
      );

      final List<MenuItem> result = todaysItems(
        menu,
        today: DateTime(2026, 9, 7),
      );

      expect(result.map((MenuItem i) => i.id).toList(), <String>[
        'breakfast-item',
        'lunch-item',
        'snacks-item',
        'dinner-item',
      ]);
    });

    test('returns [] for a day with nothing planned', () {
      final Menu menu = Menu(
        id: 'menu-1',
        householdId: 'household-1',
        weekStartDate: DateTime.utc(2026, 9, 7),
        items: const <MenuItem>[],
      );

      expect(todaysItems(menu, today: DateTime(2026, 9, 7)), isEmpty);
    });

    test('preserves placement-time order for multiple items sharing the same mealSlot — the sort is stable', () {
      // A household's own lunch can hold up to 3 items at once
      // (domain/meal_slot_plan.dart's own carb/sabziDal/accompaniment
      // structure) — `Menu.itemsForDay` already orders same-mealSlot items
      // by placement time, and `todaysItems`' own re-sort by meal-type
      // MUST preserve that relative order rather than shuffling it
      // (Dart's `List.sort` does not guarantee this; `todaysItems` uses
      // `mergeSort` specifically so this test can pass reliably).
      final Menu menu = Menu(
        id: 'menu-1',
        householdId: 'household-1',
        weekStartDate: DateTime.utc(2026, 9, 7),
        items: <MenuItem>[
          _item('lunch-first', 0, 'lunch'),
          _item('lunch-second', 0, 'lunch'),
          _item('lunch-third', 0, 'lunch'),
        ],
      );

      final List<MenuItem> result = todaysItems(
        menu,
        today: DateTime(2026, 9, 7),
      );

      expect(result.map((MenuItem i) => i.id).toList(), <String>[
        'lunch-first',
        'lunch-second',
        'lunch-third',
      ]);
    });

    test('an unrecognised mealSlot sorts last rather than throwing', () {
      final Menu menu = Menu(
        id: 'menu-1',
        householdId: 'household-1',
        weekStartDate: DateTime.utc(2026, 9, 7),
        items: <MenuItem>[
          _item('unknown-item', 0, 'brunch'),
          _item('breakfast-item', 0, 'breakfast'),
        ],
      );

      final List<MenuItem> result = todaysItems(
        menu,
        today: DateTime(2026, 9, 7),
      );

      expect(result.map((MenuItem i) => i.id).toList(), <String>[
        'breakfast-item',
        'unknown-item',
      ]);
    });
  });
}
