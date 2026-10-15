import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/presentation/list_preview_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/colors.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_shopping_list_repository.dart';
import '../../../support/shopping_list_fixtures.dart';

const ShoppingListFlowExtra _extra = (
  menuId: 'menu-1',
  householdId: 'household-1',
);

ShoppingListItem _item(
  String id,
  String name,
  String category, {
  String? recipe = 'r1',
  double quantity = 1,
  String unit = 'kg',
}) => ShoppingListItem(
  id: id,
  name: name,
  quantity: quantity,
  unit: unit,
  category: category,
  sourceRecipeId: recipe,
  purchased: false,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
);

ShoppingList _list(List<ShoppingListItem> items) => ShoppingList(
  id: 'shopping-list-1',
  householdId: 'household-1',
  generatedFromMenuId: 'menu-1',
  createdAt: DateTime.utc(2026, 9, 1),
  closedAt: null,
  aiStaplesNote: null,
  items: items,
);

Future<void> _pump(
  WidgetTester tester,
  FakeShoppingListRepository repository,
) async {
  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.shoppingListPreview,
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.shoppingListPreview,
        builder: (BuildContext context, GoRouterState state) =>
            const ListPreviewScreen(extra: _extra),
      ),
      GoRoute(
        path: AppRoutes.shoppingListNotificationPrompt,
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('notification-route')),
      ),
      GoRoute(
        path: AppRoutes.shoppingList,
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('list-route')),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        shoppingListRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('ListPreviewScreen — generate-list preview (wireframe 6.5, C2)', () {
    testWidgets('shows the badge, hint, mono-caps sections and Confirm list', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        FakeShoppingListRepository(
          generateResult: _list(<ShoppingListItem>[
            _item('a', 'Onion', 'produce', recipe: 'r1'),
            _item(
              'b',
              'Paneer',
              'dairy',
              recipe: 'r2',
              quantity: 500,
              unit: 'g',
            ),
          ]),
        ),
      );

      expect(find.text('Shopping list preview'), findsOneWidget);
      expect(find.text('◆ Generated from 2 recipes'), findsOneWidget);
      expect(
        find.text('Aggregated ingredients. Already in pantry are excluded.'),
        findsOneWidget,
      );
      expect(find.text('PRODUCE'), findsOneWidget);
      expect(find.text('DAIRY'), findsOneWidget);
      expect(find.text('500 g'), findsOneWidget);
      expect(find.text('Confirm list'), findsOneWidget);
    });

    testWidgets('the badge sits on haldi-soft', (WidgetTester tester) async {
      await _pump(
        tester,
        FakeShoppingListRepository(generateResult: testShoppingList),
      );

      final DecoratedBox badge = tester.widget<DecoratedBox>(
        find.byKey(ListPreviewScreen.badgeKey),
      );
      expect((badge.decoration as BoxDecoration).color, AppColors.haldiSoft);
    });

    testWidgets('Confirm list continues the flow', (WidgetTester tester) async {
      await _pump(
        tester,
        FakeShoppingListRepository(generateResult: testShoppingList),
      );

      await tester.tap(find.byKey(ListPreviewScreen.doneButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('notification-route'), findsOneWidget);
    });

    testWidgets('preview rows are plain: no swipe', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        FakeShoppingListRepository(generateResult: testShoppingList),
      );

      expect(find.byType(Dismissible), findsNothing);
    });

    testWidgets('an empty list keeps its empty state with a Done action', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        FakeShoppingListRepository(generateResult: testEmptyShoppingList),
      );

      expect(find.byKey(ListPreviewScreen.emptyKey), findsOneWidget);
      expect(find.byKey(ListPreviewScreen.doneButtonKey), findsOneWidget);
      expect(find.byKey(ListPreviewScreen.badgeKey), findsNothing);
    });

    testWidgets('a failure keeps the inline error with Try again', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        FakeShoppingListRepository(
          generateError: const ValidationError('Could not build a list.'),
        ),
      );

      expect(find.byKey(ListPreviewScreen.errorKey), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('no overflow at 320 pt', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await _pump(
        tester,
        FakeShoppingListRepository(
          generateResult: _list(<ShoppingListItem>[
            _item(
              'a',
              'Kashmiri red chilli powder with a very long name',
              'spice',
            ),
          ]),
        ),
      );

      expect(tester.takeException(), isNull);
    });

    testWidgets('Confirm list is at least 44 pt tall', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        FakeShoppingListRepository(generateResult: testShoppingList),
      );
      expect(
        tester.getSize(find.byKey(ListPreviewScreen.doneButtonKey)).height,
        greaterThanOrEqualTo(44),
      );
    });
  });
}
