import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/presentation/checklist_item.dart';
import 'package:mobile/features/shopping_list/presentation/have_it_quantity_sheet.dart';
import 'package:mobile/features/shopping_list/state/current_shopping_list_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_shopping_list_repository.dart';

const String _menuId = 'menu-1';

ShoppingListItem _item(
  String id,
  String name, {
  double? quantity = 1,
  String? unit = 'kg',
  bool purchased = false,
}) => ShoppingListItem(
  id: id,
  name: name,
  quantity: quantity,
  unit: unit,
  category: 'produce',
  sourceRecipeId: 'r1',
  purchased: purchased,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
);

ShoppingList _list(List<ShoppingListItem> items) => ShoppingList(
  id: 'list-1',
  householdId: 'household-1',
  generatedFromMenuId: _menuId,
  createdAt: DateTime.utc(2026, 9, 1),
  closedAt: null,
  aiStaplesNote: null,
  items: items,
);

Future<void> _pumpList(
  WidgetTester tester,
  FakeShoppingListRepository repository,
) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      shoppingListRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Scaffold(
          body: Consumer(
            builder: (BuildContext context, WidgetRef ref, _) {
              final AsyncValue<ShoppingList> list = ref.watch(
                currentShoppingListControllerProvider(_menuId),
              );
              return CategorizedChecklist(
                items: list.valueOrNull?.toBuy ?? const <ShoppingListItem>[],
                menuId: _menuId,
              );
            },
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

bool _isChecked(WidgetTester tester, String id) => tester
    .widget<ChecklistCheckBox>(find.byKey(ChecklistItem.checkboxKey(id)))
    .isChecked;

void main() {
  group('rows keep their own state (review HIGH 1)', () {
    testWidgets('ticking the first of three rows never checks the next one', (
      WidgetTester tester,
    ) async {
      final ShoppingListItem a = _item('a', 'Onion');
      final ShoppingListItem b = _item('b', 'Tomato');
      final ShoppingListItem c = _item('c', 'Potato');
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: _list(<ShoppingListItem>[a, b, c]),
        markPurchasedResult: _list(<ShoppingListItem>[
          _item('a', 'Onion', purchased: true),
          b,
          c,
        ]),
        delay: const Duration(milliseconds: 50),
      );
      await _pumpList(tester, repository);

      await tester.tap(find.byKey(ChecklistItem.checkboxKey('a')));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pumpAndSettle();

      expect(find.byKey(ChecklistItem.rowKey('a')), findsNothing);
      expect(find.byKey(ChecklistItem.rowKey('b')), findsOneWidget);
      expect(find.byKey(ChecklistItem.rowKey('c')), findsOneWidget);
      expect(_isChecked(tester, 'b'), isFalse);
      expect(_isChecked(tester, 'c'), isFalse);
    });
  });

  group('real drags (review MEDIUM)', () {
    testWidgets('dragging left opens the Have it sheet, never marks bought', (
      WidgetTester tester,
    ) async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: _list(<ShoppingListItem>[_item('a', 'Onion')]),
        haveItResult: _list(<ShoppingListItem>[]),
      );
      await _pumpList(tester, repository);

      await tester.drag(
        find.byKey(ChecklistItem.rowKey('a')),
        const Offset(-400, 0),
      );
      await tester.pumpAndSettle();

      expect(find.byType(HaveItQuantitySheet), findsOneWidget);
      expect(repository.markPurchasedCalls, isEmpty);
    });

    testWidgets('dragging right marks bought and removes the row', (
      WidgetTester tester,
    ) async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: _list(<ShoppingListItem>[_item('a', 'Onion')]),
        markPurchasedResult: _list(<ShoppingListItem>[
          _item('a', 'Onion', purchased: true),
        ]),
      );
      await _pumpList(tester, repository);

      await tester.drag(
        find.byKey(ChecklistItem.rowKey('a')),
        const Offset(400, 0),
      );
      await tester.pumpAndSettle();

      expect(repository.markPurchasedCalls, <String>['a']);
      expect(repository.haveItCalls, isEmpty);
      expect(find.byKey(ChecklistItem.rowKey('a')), findsNothing);
    });

    testWidgets('a failed swipe-right shows a snackbar and reverts the row', (
      WidgetTester tester,
    ) async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: _list(<ShoppingListItem>[_item('a', 'Onion')]),
        markPurchasedError: const ConflictError('Already bought.'),
      );
      await _pumpList(tester, repository);

      await tester.drag(
        find.byKey(ChecklistItem.rowKey('a')),
        const Offset(400, 0),
      );
      await tester.pumpAndSettle();

      expect(find.text('Already bought.'), findsOneWidget);
      expect(find.byKey(ChecklistItem.rowKey('a')), findsOneWidget);
      expect(_isChecked(tester, 'a'), isFalse);
    });

    testWidgets('a repeated swipe-right fires markPurchased once', (
      WidgetTester tester,
    ) async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: _list(<ShoppingListItem>[_item('a', 'Onion')]),
        markPurchasedResult: _list(<ShoppingListItem>[
          _item('a', 'Onion', purchased: true),
        ]),
        delay: const Duration(milliseconds: 100),
      );
      await _pumpList(tester, repository);

      await tester.drag(
        find.byKey(ChecklistItem.rowKey('a')),
        const Offset(400, 0),
      );
      await tester.pump();
      await tester.drag(
        find.byKey(ChecklistItem.rowKey('a')),
        const Offset(400, 0),
      );
      await tester.pumpAndSettle();

      expect(repository.markPurchasedCalls, <String>['a']);
    });
  });

  group('quantity is never truncated (review HIGH 2)', () {
    testWidgets('0.3333333333333333 cup shows as "0.33 cup"', (
      WidgetTester tester,
    ) async {
      await _pumpList(
        tester,
        FakeShoppingListRepository(
          generateResult: _list(<ShoppingListItem>[
            _item('a', 'Sugar', quantity: 0.3333333333333333, unit: 'cup'),
          ]),
        ),
      );

      expect(find.text('0.33 cup'), findsOneWidget);
    });

    testWidgets('long name + unit at 2x text, 320 pt: unit never ellipsized', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(() {
        tester.view.reset();
        tester.platformDispatcher.clearAllTestValues();
      });
      await _pumpList(
        tester,
        FakeShoppingListRepository(
          generateResult: _list(<ShoppingListItem>[
            _item(
              'a',
              'Kashmiri red chilli powder with a long name',
              quantity: 0.3333333333333333,
              unit: 'tablespoon',
            ),
          ]),
        ),
      );

      expect(tester.takeException(), isNull);
      final Text quantity = tester.widget<Text>(
        find.text('0.33 tablespoon'),
      );
      expect(quantity.overflow, isNot(TextOverflow.ellipsis));
      expect(quantity.maxLines, isNull);
    });
  });

  group('check box is keyboard reachable (review MEDIUM)', () {
    testWidgets('the check box is focusable and not a button+checked mix', (
      WidgetTester tester,
    ) async {
      await _pumpList(
        tester,
        FakeShoppingListRepository(
          generateResult: _list(<ShoppingListItem>[_item('a', 'Onion')]),
        ),
      );

      expect(
        find.descendant(
          of: find.byKey(ChecklistItem.checkboxKey('a')),
          matching: find.byType(InkWell),
        ),
        findsOneWidget,
      );
    });
  });
}
