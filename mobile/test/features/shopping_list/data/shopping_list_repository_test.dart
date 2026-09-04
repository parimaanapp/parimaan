import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';
import '../../../support/shopping_list_fixtures.dart';

/// Builds a real Ferry [Client] over a [FakeLink] — see that class's doc for
/// why this is preferred to mocking `Client` itself. Same shape as
/// `menu_repository_test.dart`'s own `_subject`.
({FerryShoppingListRepository repository, FakeLink link}) _subject(
  Map<String, dynamic> Function(Request request) respond,
) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (repository: FerryShoppingListRepository(client: client), link: link);
}

Map<String, dynamic> _errorBody(String errorType, String message) =>
    <String, dynamic>{
      'data': null,
      'errors': <dynamic>[
        <String, dynamic>{
          'path': <String>['fetch'],
          'errorType': errorType,
          'message': message,
        },
      ],
    };

void main() {
  group('FerryShoppingListRepository.generateShoppingList', () {
    test('sends the GenerateShoppingList mutation with menuId and maps the full list', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': generateShoppingListWireData(
            shoppingList: shoppingListWireNode(
              items: <Map<String, dynamic>>[shoppingListItemWireNode()],
            ),
          ),
        },
      );

      final ShoppingList result = await subject.repository.generateShoppingList(
        'menu-1',
      );

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'GenerateShoppingList');
      expect(sent.variables['menuId'], 'menu-1');
      expect(result.id, 'shopping-list-1');
      expect(result.items, hasLength(1));
      expect(result.items.single.name, 'Rice');
    });

    test(
      'an empty menu returns a list with zero items — never an error',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': generateShoppingListWireData(
              shoppingList: shoppingListWireNode(
                items: <Map<String, dynamic>>[],
              ),
            ),
          },
        );

        final ShoppingList result = await subject.repository
            .generateShoppingList('menu-1');

        expect(result.items, isEmpty);
      },
    );

    test('a second-call-while-open-list-exists rejection surfaces as a typed ConflictError, not swallowed', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('CONFLICT', 'An open shopping list already exists.'),
      );

      await expectLater(
        subject.repository.generateShoppingList('menu-1'),
        throwsA(isA<ConflictError>()),
      );
    });

    test('a non-member rejection surfaces as a typed ForbiddenError', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('FORBIDDEN', 'You are not a member of this household.'),
      );

      await expectLater(
        subject.repository.generateShoppingList('menu-1'),
        throwsA(isA<ForbiddenError>()),
      );
    });
  });

  group('FerryShoppingListRepository.regenerateShoppingList', () {
    test('threads confirmed: false through to the wire variables and returns the preview, unpersisted, list', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': regenerateShoppingListWireData(),
        },
      );

      await subject.repository.regenerateShoppingList(
        'menu-1',
        confirmed: false,
      );

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'RegenerateShoppingList');
      expect(sent.variables['menuId'], 'menu-1');
      expect(sent.variables['confirmed'], isFalse);
    });

    test('threads confirmed: true through to the wire variables and returns the committed, merged list', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': regenerateShoppingListWireData(),
        },
      );

      final ShoppingList result = await subject.repository
          .regenerateShoppingList('menu-1', confirmed: true);

      final Request sent = subject.link.requests.single;
      expect(sent.variables['confirmed'], isTrue);
      expect(result.id, 'shopping-list-1');
    });

    test(
      'a server rejection surfaces as a typed AppError, not swallowed',
      () async {
        final subject = _subject(
          (Request _) => _errorBody(
            'FORBIDDEN',
            'You are not a member of this household.',
          ),
        );

        await expectLater(
          subject.repository.regenerateShoppingList('menu-1', confirmed: false),
          throwsA(isA<ForbiddenError>()),
        );
      },
    );
  });

  group('FerryShoppingListRepository.haveIt', () {
    test('sends the HaveIt mutation with itemId/quantity and returns the full parent list', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': haveItWireData(
            shoppingList: shoppingListWireNode(
              items: <Map<String, dynamic>>[
                shoppingListItemWireNode(
                  purchased: true,
                  purchasedBy: 'user-1',
                  purchasedAt: '2026-09-03T12:00:00.000Z',
                  movedToPantry: true,
                ),
              ],
            ),
          ),
        },
      );

      final ShoppingList result = await subject.repository.haveIt(
        'item-1',
        2.5,
      );

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'HaveIt');
      expect(sent.variables['itemId'], 'item-1');
      expect(sent.variables['quantity'], 2.5);
      expect(result.items.single.purchased, isTrue);
      expect(result.items.single.movedToPantry, isTrue);
    });

    test(
      'an already-purchased item rejection surfaces as a typed ConflictError',
      () async {
        final subject = _subject(
          (Request _) =>
              _errorBody('CONFLICT', 'This item was already bought.'),
        );

        await expectLater(
          subject.repository.haveIt('item-1', 2.5),
          throwsA(isA<ConflictError>()),
        );
      },
    );

    test(
      'a zero/invalid quantity rejection surfaces as a typed ValidationError',
      () async {
        final subject = _subject(
          (Request _) => _errorBody('VALIDATION', 'quantity must be positive.'),
        );

        await expectLater(
          subject.repository.haveIt('item-1', 0),
          throwsA(isA<ValidationError>()),
        );
      },
    );
  });

  group('FerryShoppingListRepository.markPurchased', () {
    test('sends the MarkPurchased mutation with itemId (no quantity) and returns the full parent list', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': markPurchasedWireData(
            shoppingList: shoppingListWireNode(
              items: <Map<String, dynamic>>[
                shoppingListItemWireNode(
                  purchased: true,
                  purchasedBy: 'user-1',
                  purchasedAt: '2026-09-03T12:00:00.000Z',
                  movedToPantry: true,
                ),
              ],
            ),
          ),
        },
      );

      final ShoppingList result = await subject.repository.markPurchased(
        'item-1',
      );

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'MarkPurchased');
      expect(sent.variables['itemId'], 'item-1');
      expect(sent.variables.containsKey('quantity'), isFalse);
      expect(result.items.single.purchased, isTrue);
      expect(result.items.single.movedToPantry, isTrue);
    });

    test(
      'an already-purchased item rejection surfaces as a typed ConflictError',
      () async {
        final subject = _subject(
          (Request _) =>
              _errorBody('CONFLICT', 'This item was already bought.'),
        );

        await expectLater(
          subject.repository.markPurchased('item-1'),
          throwsA(isA<ConflictError>()),
        );
      },
    );
  });

  group('FerryShoppingListRepository.watchShoppingListChanges', () {
    test(
      'sends the OnShoppingListChanged operation with the householdId variable',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': onShoppingListChangedWireData(),
          },
        );

        await subject.repository.watchShoppingListChanges('household-1').first;

        final Request sent = subject.link.requests.single;
        expect(sent.operation.operationName, 'OnShoppingListChanged');
        expect(sent.variables['householdId'], 'household-1');
      },
    );

    test('emits the pushed ShoppingList — unlike watchPantryChanges, the payload IS the fresh state', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': onShoppingListChangedWireData(
            shoppingList: shoppingListWireNode(id: 'shopping-list-2'),
          ),
        },
      );

      final ShoppingList result = await subject.repository
          .watchShoppingListChanges('household-1')
          .first;

      expect(result.id, 'shopping-list-2');
    });

    test('a subscribe-time FORBIDDEN denial maps to ForbiddenError', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('FORBIDDEN', 'You are not a member of this household.'),
      );

      await expectLater(
        subject.repository.watchShoppingListChanges('household-1').first,
        throwsA(isA<ForbiddenError>()),
      );
    });
  });
}
