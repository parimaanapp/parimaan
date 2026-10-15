import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/menu/domain/meal_slot_plan.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_grid.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/shared/ui/colors.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/contrast.dart';
import '../../../support/menu_fixtures.dart';

const String _structure =
    '{"lunch":{"carb":1,"sabzi_dal":2,"accompaniment":1},'
    '"dinner":{"carb":1,"sabzi_dal":1,"accompaniment":0}}';

Recipe _recipe(String id, String title, RecipeRole role) => Recipe(
  id: id,
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: title,
  servings: 4,
  dietaryTags: const <String>[],
  role: role,
  inRotation: true,
  isFavorite: false,
  steps: const <String>[],
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
);

MenuItem _item(
  String id,
  String title, {
  int day = 0,
  String meal = 'lunch',
  RecipeRole role = RecipeRole.sabziDal,
}) => MenuItem(
  id: id,
  menuId: 'menu-1',
  recipe: _recipe(id, title, role),
  dayOfWeek: day,
  mealSlot: meal,
  slotRole: role,
);

Menu _menu(List<String> meals, [List<MenuItem> items = const <MenuItem>[]]) =>
    Menu(
      id: 'menu-1',
      householdId: 'household-1',
      weekStartDate: DateTime.utc(2026, 10, 12),
      items: items,
      mealConfigSnapshot: mealConfigSnapshotJsonFor(
        HouseholdSettings(
          householdId: 'household-1',
          mealsEnabled: meals,
          mealStructureJson: _structure,
          cuisineTier1: const <String>[],
          cuisineTier2WeightsJson: '{}',
          dietaryTags: const <String>[],
          allergens: const <String>[],
          skipIngredients: const <String>[],
        ),
      ),
    );

const List<String> _allFour = <String>[
  'breakfast',
  'lunch',
  'snacks',
  'dinner',
];

Future<void> _pump(
  WidgetTester tester,
  Menu menu, {
  double width = 390,
  double textScale = 1.0,
  int? today,
  void Function(int, PlannedSlot)? onAdd,
  void Function(int)? onDayMenu,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          size: Size(width, 800),
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: width,
            height: 800,
            child: WeeklyPlanGrid(
              menu: menu,
              todayDayOfWeek: today,
              onAddToSlot: onAdd ?? (int d, PlannedSlot s) {},
              onDayMenu: onDayMenu ?? (int d) {},
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  group('layout selection by planned-meal count', () {
    for (final List<String> meals in <List<String>>[
      <String>['lunch'],
      <String>['breakfast', 'dinner'],
      <String>['breakfast', 'lunch', 'dinner'],
    ]) {
      testWidgets('${meals.length} meal(s) -> column layout with headers', (
        WidgetTester tester,
      ) async {
        await _pump(tester, _menu(meals));
        expect(find.byKey(WeeklyPlanGrid.columnLayoutKey), findsOneWidget);
        expect(find.byKey(WeeklyPlanGrid.blockLayoutKey), findsNothing);
        for (final String m in meals) {
          expect(
            find.byKey(
              WeeklyPlanGrid.columnHeaderKey(MealType.values.byName(m)),
            ),
            findsOneWidget,
          );
        }
        expect(
          find.byKey(WeeklyPlanGrid.columnHeaderKey(MealType.snacks)),
          findsNothing,
        );
      });
    }

    testWidgets('four meals -> 2x2 block layout and no header row', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(_allFour));
      expect(find.byKey(WeeklyPlanGrid.blockLayoutKey), findsOneWidget);
      expect(find.byKey(WeeklyPlanGrid.columnLayoutKey), findsNothing);
      for (final MealType m in MealType.values) {
        expect(find.byKey(WeeklyPlanGrid.columnHeaderKey(m)), findsNothing);
      }
      // The list is lazy; the first days are enough to prove the cell grid.
      for (int d = 0; d < 2; d++) {
        for (final MealType m in MealType.values) {
          expect(find.byKey(WeeklyPlanGrid.cellKey(d, m)), findsOneWidget);
        }
      }
    });

    testWidgets('no planned meals -> a single empty message', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(<String>[]));
      expect(find.text('No meals configured for this week.'), findsOneWidget);
    });
  });

  group('cell content', () {
    testWidgets('filled cell stacks the recipe names and names its meal', (
      WidgetTester tester,
    ) async {
      final Menu menu = _menu(_allFour, <MenuItem>[
        _item('a', 'Rice', role: RecipeRole.carb),
        _item('b', 'Dal tadka'),
      ]);
      await _pump(tester, menu);
      final Finder cell = find.byKey(WeeklyPlanGrid.cellKey(0, MealType.lunch));
      // Each title is its own single-line Text.
      expect(
        find.descendant(of: cell, matching: find.text('Rice')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: cell, matching: find.text('Dal tadka')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: cell, matching: find.text('LUNCH')),
        findsOneWidget,
      );
    });

    testWidgets('more than three names collapse to two names and +N', (
      WidgetTester tester,
    ) async {
      final Menu menu = _menu(
        <String>['lunch'],
        <MenuItem>[
          _item('a', 'Rice', role: RecipeRole.carb),
          _item('b', 'Dal'),
          _item('c', 'Aloo'),
          _item('d', 'Raita', role: RecipeRole.accompaniment),
        ],
      );
      await _pump(tester, menu, width: 320);
      expect(find.text('Rice'), findsOneWidget);
      expect(find.text('Dal'), findsOneWidget);
      expect(find.text('Aloo'), findsNothing);
      final Finder count = find.byKey(WeeklyPlanGrid.overflowCountKey);
      expect(count, findsOneWidget);
      expect(tester.widget<Text>(count).data, '+2');
    });

    testWidgets('+N survives long names at 320 pt and 2.0 text scale', (
      WidgetTester tester,
    ) async {
      const String long = 'Extraordinarily long vegetable biryani with saffron';
      final Menu menu = _menu(
        <String>['lunch'],
        <MenuItem>[
          _item('a', long, role: RecipeRole.carb),
          _item('b', long),
          _item('c', long),
          _item('d', long, role: RecipeRole.accompaniment),
        ],
      );
      await _pump(tester, menu, width: 320, textScale: 2.0);
      final Finder count = find.byKey(WeeklyPlanGrid.overflowCountKey);
      final Rect cell = tester.getRect(
        find.byKey(WeeklyPlanGrid.cellKey(0, MealType.lunch)),
      );
      expect(cell.contains(tester.getTopLeft(count)), isTrue);
      expect(cell.contains(tester.getBottomRight(count)), isTrue);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a partly filled meal shows how many slots remain', (
      WidgetTester tester,
    ) async {
      final Menu menu = _menu(
        <String>['lunch'],
        <MenuItem>[_item('a', 'Rice', role: RecipeRole.carb)],
      );
      await _pump(tester, menu);
      final Finder remaining = find.descendant(
        of: find.byKey(WeeklyPlanGrid.cellKey(0, MealType.lunch)),
        matching: find.byKey(WeeklyPlanGrid.remainingKey),
      );
      expect(remaining, findsOneWidget);
      expect(tester.widget<Text>(remaining).data, '＋3');
    });

    testWidgets('a complete meal shows no remaining marker', (
      WidgetTester tester,
    ) async {
      final Menu menu = _menu(
        <String>['dinner'],
        <MenuItem>[
          _item('a', 'Roti', meal: 'dinner', role: RecipeRole.carb),
          _item('b', 'Bhindi', meal: 'dinner'),
        ],
      );
      await _pump(tester, menu);
      expect(find.byKey(WeeklyPlanGrid.remainingKey), findsNothing);
    });

    testWidgets('empty cell in block layout: plus with meal name beneath', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(_allFour));
      final Finder cell = find.byKey(
        WeeklyPlanGrid.cellKey(0, MealType.snacks),
      );
      final Finder plus = find.descendant(
        of: cell,
        matching: find.byKey(WeeklyPlanGrid.plusKey),
      );
      final Finder label = find.descendant(
        of: cell,
        matching: find.text('SNACKS'),
      );
      expect(plus, findsOneWidget);
      expect(label, findsOneWidget);
      expect(
        tester.getTopLeft(label).dy,
        greaterThan(tester.getTopLeft(plus).dy),
      );
      expect(tester.widget<Text>(plus).style!.color, AppColors.terracotta);
    });

    testWidgets('empty cell in column layout: plus only, no meal label', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(<String>['breakfast', 'lunch']));
      final Finder cell = find.byKey(
        WeeklyPlanGrid.cellKey(0, MealType.breakfast),
      );
      expect(
        find.descendant(of: cell, matching: find.byKey(WeeklyPlanGrid.plusKey)),
        findsOneWidget,
      );
      expect(
        find.descendant(of: cell, matching: find.text('BREAKFAST')),
        findsNothing,
      );
    });
  });

  group('colours', () {
    testWidgets('each meal uses its token colour', (WidgetTester tester) async {
      await _pump(
        tester,
        _menu(_allFour, <MenuItem>[
          _item('b', 'Poha', meal: 'breakfast', role: RecipeRole.breakfast),
          _item('l', 'Dal'),
          _item('s', 'Chai', meal: 'snacks', role: RecipeRole.snack),
          _item('d', 'Roti', meal: 'dinner', role: RecipeRole.carb),
        ]),
      );
      Color? fill(MealType m) {
        final Container c = tester.widget<Container>(
          find.descendant(
            of: find.byKey(WeeklyPlanGrid.cellKey(0, m)),
            matching: find.byKey(WeeklyPlanGrid.cellSurfaceKey),
          ),
        );
        return (c.decoration! as BoxDecoration).color;
      }

      expect(fill(MealType.breakfast), AppColors.haldi);
      expect(fill(MealType.lunch), AppColors.terracottaDeep);
      expect(fill(MealType.snacks), AppColors.inkSoft);
      expect(fill(MealType.dinner), AppColors.cardamom);
    });
  });

  group('today highlight', () {
    testWidgets("only today's card is outlined terracotta", (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(<String>['lunch']), today: 2);
      Color? borderColor(int d) {
        final Container c = tester.widget<Container>(
          find.byKey(WeeklyPlanGrid.dayCardKey(d)),
        );
        return ((c.decoration! as BoxDecoration).border! as Border).top.color;
      }

      expect(borderColor(2), AppColors.terracotta);
      expect(borderColor(1), isNot(AppColors.terracotta));
      expect(borderColor(3), isNot(AppColors.terracotta));
    });

    testWidgets('no today means no highlighted card', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(<String>['lunch']));
      for (int d = 0; d < 4; d++) {
        final Container c = tester.widget<Container>(
          find.byKey(WeeklyPlanGrid.dayCardKey(d)),
        );
        expect(
          ((c.decoration! as BoxDecoration).border! as Border).top.color,
          isNot(AppColors.terracotta),
        );
      }
    });
  });

  group('tap targets and semantics', () {
    testWidgets('every cell and day label is at least 44 pt tall', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(_allFour));
      for (int d = 0; d < 2; d++) {
        for (final MealType m in MealType.values) {
          expect(
            tester.getSize(find.byKey(WeeklyPlanGrid.cellKey(d, m))).height,
            greaterThanOrEqualTo(44),
          );
        }
        expect(
          tester.getSize(find.byKey(WeeklyPlanGrid.dayMenuKey(d))).height,
          greaterThanOrEqualTo(44),
        );
        expect(
          tester.getSize(find.byKey(WeeklyPlanGrid.dayMenuKey(d))).width,
          greaterThanOrEqualTo(44),
        );
      }
    });

    testWidgets('semantics labels read "Monday lunch: ..."', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        _menu(
          <String>['breakfast', 'lunch'],
          <MenuItem>[
            _item('a', 'Rice', role: RecipeRole.carb),
            _item('b', 'Dal'),
          ],
        ),
      );
      expect(
        find.bySemanticsLabel(
          'Monday lunch: Rice, Dal; 2 of 4 filled, next: '
          '${RecipeRole.sabziDal.displayLabel}',
        ),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel('Tuesday breakfast: empty, add a recipe'),
        findsOneWidget,
      );
      handle.dispose();
    });
  });

  group('today semantics', () {
    testWidgets('the highlighted day says Today in its labels', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, _menu(<String>['lunch']), today: 1);
      expect(
        find.bySemanticsLabel(RegExp('^Today, Tuesday lunch')),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel('More Tuesday actions, today'),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel(RegExp('^Today, Monday')), findsNothing);
      handle.dispose();
    });
  });

  group('contrast', () {
    testWidgets('filled cells: text >= 4.5:1 and labels >= 11 pt', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _menu(_allFour, <MenuItem>[
          _item('b', 'Poha', meal: 'breakfast', role: RecipeRole.breakfast),
          _item('l', 'Dal'),
          _item('s', 'Chai', meal: 'snacks', role: RecipeRole.snack),
          _item('d', 'Roti', meal: 'dinner', role: RecipeRole.carb),
        ]),
      );
      for (final MealType m in MealType.values) {
        final Finder cell = find.byKey(WeeklyPlanGrid.cellKey(0, m));
        final Container surface = tester.widget(
          find.descendant(
            of: cell,
            matching: find.byKey(WeeklyPlanGrid.cellSurfaceKey),
          ),
        );
        final Color fill = (surface.decoration! as BoxDecoration).color!;
        final Iterable<Text> texts = tester.widgetList<Text>(
          find.descendant(of: cell, matching: find.byType(Text)),
        );
        expect(texts, isNotEmpty);
        for (final Text t in texts) {
          expect(
            contrastRatio(t.style!.color!, fill),
            greaterThanOrEqualTo(4.5),
            reason: '${m.name} "${t.data}"',
          );
          expect(t.style!.fontSize, greaterThanOrEqualTo(11));
        }
      }
    });

    testWidgets('empty cells: label >= 4.5:1, border and plus >= 3:1', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(_allFour));
      final Finder cell = find.byKey(
        WeeklyPlanGrid.cellKey(0, MealType.snacks),
      );
      final Container surface = tester.widget(
        find.descendant(
          of: cell,
          matching: find.byKey(WeeklyPlanGrid.cellSurfaceKey),
        ),
      );
      final Border border =
          (surface.decoration! as BoxDecoration).border! as Border;
      expect(
        contrastRatio(border.top.color, AppColors.card),
        greaterThanOrEqualTo(3),
      );
      for (final Text t in tester.widgetList<Text>(
        find.descendant(of: cell, matching: find.byType(Text)),
      )) {
        expect(
          contrastRatio(t.style!.color!, AppColors.card),
          greaterThanOrEqualTo(t.key == WeeklyPlanGrid.plusKey ? 3 : 4.5),
        );
        expect(t.style!.fontSize, greaterThanOrEqualTo(11));
      }
    });

    testWidgets('column headers are >= 4.5:1 and >= 11 pt', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _menu(<String>['lunch']));
      final Text header = tester.widget(
        find.byKey(WeeklyPlanGrid.columnHeaderKey(MealType.lunch)),
      );
      expect(
        contrastRatio(header.style!.color!, AppColors.paper),
        greaterThanOrEqualTo(4.5),
      );
      expect(header.style!.fontSize, greaterThanOrEqualTo(11));
    });
  });

  group('taps', () {
    testWidgets('empty cell opens the first empty slot of that meal', (
      WidgetTester tester,
    ) async {
      final List<(int, PlannedSlot)> calls = <(int, PlannedSlot)>[];
      await _pump(
        tester,
        _menu(<String>['lunch']),
        onAdd: (int d, PlannedSlot s) => calls.add((d, s)),
      );
      await tester.tap(find.byKey(WeeklyPlanGrid.cellKey(1, MealType.lunch)));
      expect(calls, hasLength(1));
      expect(calls.single.$1, 1);
      expect(calls.single.$2.mealType, MealType.lunch);
      expect(calls.single.$2.slotRole, RecipeRole.carb);
      expect(calls.single.$2.isFilled, isFalse);
    });

    testWidgets('partially filled cell targets the NEXT empty slot', (
      WidgetTester tester,
    ) async {
      final List<(int, PlannedSlot)> calls = <(int, PlannedSlot)>[];
      await _pump(
        tester,
        _menu(
          <String>['lunch'],
          <MenuItem>[
            _item('a', 'Rice', role: RecipeRole.carb),
            _item('b', 'Dal'),
          ],
        ),
        onAdd: (int d, PlannedSlot s) => calls.add((d, s)),
      );
      await tester.tap(find.byKey(WeeklyPlanGrid.cellKey(0, MealType.lunch)));
      expect(calls.single.$2.slotRole, RecipeRole.sabziDal);
      expect(calls.single.$2.isFilled, isFalse);
    });

    testWidgets('a fully filled cell is inert', (WidgetTester tester) async {
      final List<(int, PlannedSlot)> calls = <(int, PlannedSlot)>[];
      await _pump(
        tester,
        _menu(
          <String>['dinner'],
          <MenuItem>[
            _item('a', 'Roti', meal: 'dinner', role: RecipeRole.carb),
            _item('b', 'Bhindi', meal: 'dinner'),
          ],
        ),
        onAdd: (int d, PlannedSlot s) => calls.add((d, s)),
      );
      await tester.tap(find.byKey(WeeklyPlanGrid.cellKey(0, MealType.dinner)));
      expect(calls, isEmpty);
    });

    testWidgets('day label opens the day menu for that day', (
      WidgetTester tester,
    ) async {
      final List<int> days = <int>[];
      await _pump(tester, _menu(<String>['lunch']), onDayMenu: days.add);
      await tester.tap(find.byKey(WeeklyPlanGrid.dayMenuKey(1)));
      expect(days, <int>[1]);
    });
  });

  group('small width', () {
    for (final bool four in <bool>[true, false]) {
      testWidgets(
        '320 pt, ${four ? "four" : "three"} meals, long names, large text: no overflow',
        (WidgetTester tester) async {
          final List<String> meals = four
              ? _allFour
              : <String>['breakfast', 'lunch', 'dinner'];
          const String long =
              'Extraordinarily long vegetable biryani with saffron';
          final List<MenuItem> items = <MenuItem>[
            for (int d = 0; d < 7; d++) ...<MenuItem>[
              _item('l$d', long, day: d),
              _item(
                'b$d',
                long,
                day: d,
                meal: 'breakfast',
                role: RecipeRole.breakfast,
              ),
              _item('d$d', long, day: d, meal: 'dinner', role: RecipeRole.carb),
            ],
          ];
          await _pump(tester, _menu(meals, items), width: 320, textScale: 1.3);
          expect(tester.takeException(), isNull);
        },
      );

      testWidgets(
        '320 pt, ${four ? "four" : "three"} meals, 2.0 text scale: no overflow',
        (WidgetTester tester) async {
          final List<String> meals = four
              ? _allFour
              : <String>['breakfast', 'lunch', 'dinner'];
          await _pump(
            tester,
            _menu(meals, <MenuItem>[_item('l', 'Dal tadka')]),
            width: 320,
            textScale: 2.0,
            today: 0,
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  });
}
