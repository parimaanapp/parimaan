import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/state/current_shopping_list_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_shopping_list_repository.dart';
import '../../../support/shopping_list_fixtures.dart';

ProviderContainer _container(FakeShoppingListRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      shoppingListRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('CurrentShoppingListController — build', () {
    test(
      'generates against menuId and returns the full list on success',
      () async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(generateResult: testShoppingList);
        final ProviderContainer container = _container(repository);

        final ShoppingList result = await container.read(
          currentShoppingListControllerProvider('menu-1').future,
        );

        expect(result, testShoppingList);
        expect(repository.generateCalls, <String>['menu-1']);
      },
    );

    test(
      'an empty menu resolves to a list with zero items — never an error',
      () async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(generateResult: testEmptyShoppingList);
        final ProviderContainer container = _container(repository);

        final ShoppingList result = await container.read(
          currentShoppingListControllerProvider('menu-1').future,
        );

        expect(result.items, isEmpty);
      },
    );

    test(
      'a generate rejection surfaces as a typed AppError, not swallowed',
      () async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateError: const ConflictError(
                'An open shopping list already exists.',
              ),
            );
        final ProviderContainer container = _container(repository);

        await expectLater(
          container.read(
            currentShoppingListControllerProvider('menu-1').future,
          ),
          throwsA(isA<ConflictError>()),
        );
      },
    );

    test('two menus are independent caches', () async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
      );
      final ProviderContainer container = _container(repository);

      await container.read(
        currentShoppingListControllerProvider('menu-1').future,
      );
      await container.read(
        currentShoppingListControllerProvider('menu-2').future,
      );

      expect(repository.generateCalls, <String>['menu-1', 'menu-2']);
    });
  });

  group('CurrentShoppingListController.regenerateShoppingList', () {
    test('confirmed: false surfaces the preview counts without mutating state as committed', () async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
        regenerateResult: testEmptyShoppingList,
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentShoppingListControllerProvider('menu-1').future,
      );

      final ShoppingList preview = await container
          .read(currentShoppingListControllerProvider('menu-1').notifier)
          .regenerateShoppingList(confirmed: false);

      expect(preview, testEmptyShoppingList);
      expect(repository.regenerateCalls, <(String, bool)>[('menu-1', false)]);
      // NOT committed: state still shows the original, generated list.
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .requireValue,
        testShoppingList,
      );
    });

    test('confirmed: true refreshes state with the merged result', () async {
      final ShoppingList merged = ShoppingList(
        id: 'shopping-list-1',
        householdId: 'household-1',
        generatedFromMenuId: 'menu-1',
        createdAt: DateTime.utc(2026, 9, 1),
        closedAt: null,
        aiStaplesNote: null,
        items: <ShoppingListItem>[testPurchasedShoppingListItem],
      );
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
        regenerateResult: merged,
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentShoppingListControllerProvider('menu-1').future,
      );

      final ShoppingList result = await container
          .read(currentShoppingListControllerProvider('menu-1').notifier)
          .regenerateShoppingList(confirmed: true);

      expect(result, merged);
      expect(repository.regenerateCalls, <(String, bool)>[('menu-1', true)]);
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .requireValue,
        merged,
      );
    });

    test('a regenerate rejection throws — the caller must see it, state is left unchanged', () async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
        regenerateError: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentShoppingListControllerProvider('menu-1').future,
      );

      await expectLater(
        container
            .read(currentShoppingListControllerProvider('menu-1').notifier)
            .regenerateShoppingList(confirmed: true),
        throwsA(isA<ForbiddenError>()),
      );
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .requireValue,
        testShoppingList,
      );
    });
  });

  group('CurrentShoppingListController.recoverFromConflict', () {
    test('confirmed: false previews without mutating state, even while build() is stuck on ConflictError', () async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateError: const ConflictError(
          'An open shopping list already exists.',
        ),
        regenerateResult: testShoppingList,
      );
      final ProviderContainer container = _container(repository);
      // `build()` fails — never awaited to success. A caller reaching
      // `regenerateShoppingList` here would re-throw this same
      // `ConflictError` (that method's own `await future` guard); this is
      // exactly the trap `recoverFromConflict` exists to route around.
      await expectLater(
        container.read(currentShoppingListControllerProvider('menu-1').future),
        throwsA(isA<ConflictError>()),
      );

      final ShoppingList preview = await container
          .read(currentShoppingListControllerProvider('menu-1').notifier)
          .recoverFromConflict(confirmed: false);

      expect(preview, testShoppingList);
      expect(repository.regenerateCalls, <(String, bool)>[('menu-1', false)]);
      // NOT committed: state is still the original ConflictError.
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .hasError,
        isTrue,
      );
    });

    test('confirmed: true commits and sets state from the response, recovering the controller', () async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateError: const ConflictError(
          'An open shopping list already exists.',
        ),
        regenerateResult: testShoppingList,
      );
      final ProviderContainer container = _container(repository);
      await expectLater(
        container.read(currentShoppingListControllerProvider('menu-1').future),
        throwsA(isA<ConflictError>()),
      );

      final ShoppingList result = await container
          .read(currentShoppingListControllerProvider('menu-1').notifier)
          .recoverFromConflict(confirmed: true);

      expect(result, testShoppingList);
      expect(repository.regenerateCalls, <(String, bool)>[('menu-1', true)]);
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .requireValue,
        testShoppingList,
      );
    });

    test(
      'a rejection throws — the caller must see it, state is left unchanged',
      () async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateError: const ConflictError(
                'An open shopping list already exists.',
              ),
              regenerateError: const ForbiddenError('Not a member.'),
            );
        final ProviderContainer container = _container(repository);
        await expectLater(
          container.read(
            currentShoppingListControllerProvider('menu-1').future,
          ),
          throwsA(isA<ConflictError>()),
        );

        await expectLater(
          container
              .read(currentShoppingListControllerProvider('menu-1').notifier)
              .recoverFromConflict(confirmed: true),
          throwsA(isA<ForbiddenError>()),
        );
        expect(
          container
              .read(currentShoppingListControllerProvider('menu-1'))
              .hasError,
          isTrue,
        );
      },
    );
  });

  group('CurrentShoppingListController.haveIt', () {
    test('refreshes controller state from the response — the item drops out of toBuy once movedToPantry', () async {
      final ShoppingList afterHaveIt = ShoppingList(
        id: 'shopping-list-1',
        householdId: 'household-1',
        generatedFromMenuId: 'menu-1',
        createdAt: DateTime.utc(2026, 9, 1),
        closedAt: null,
        aiStaplesNote: null,
        items: <ShoppingListItem>[testPurchasedShoppingListItem],
      );
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
        haveItResult: afterHaveIt,
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentShoppingListControllerProvider('menu-1').future,
      );
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .requireValue
            .toBuy,
        <ShoppingListItem>[testShoppingListItem],
      );

      final ShoppingList result = await container
          .read(currentShoppingListControllerProvider('menu-1').notifier)
          .haveIt('item-1', 2);

      expect(result, afterHaveIt);
      expect(repository.haveItCalls, <(String, double)>[('item-1', 2)]);
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .requireValue
            .toBuy,
        isEmpty,
      );
    });

    test('a haveIt rejection throws — the caller must see it, state is left unchanged', () async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
        haveItError: const ConflictError('This item was already bought.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(
        currentShoppingListControllerProvider('menu-1').future,
      );

      await expectLater(
        container
            .read(currentShoppingListControllerProvider('menu-1').notifier)
            .haveIt('item-1', 2),
        throwsA(isA<ConflictError>()),
      );
      expect(
        container
            .read(currentShoppingListControllerProvider('menu-1'))
            .requireValue,
        testShoppingList,
      );
    });
  });
}
