import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';
import '../../../support/menu_fixtures.dart';

/// Builds a real Ferry [Client] over a [FakeLink] — see that class's doc for
/// why this is preferred to mocking `Client` itself. Same shape as
/// `household_repository_test.dart`'s own `_subject`.
({FerryMenuRepository repository, FakeLink link}) _subject(
  Map<String, dynamic> Function(Request request) respond,
) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (repository: FerryMenuRepository(client: client), link: link);
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
  group('FerryMenuRepository.fetchMenu', () {
    test(
      'sends the Menu query with householdId/weekStartDate variables',
      () async {
        final weekStartDate = DateTime.utc(2026, 9, 7);
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': menuQueryWireData(menu: menuWireNode()),
          },
        );

        await subject.repository.fetchMenu('household-1', weekStartDate);

        expect(subject.link.requests, hasLength(1));
        final Request sent = subject.link.requests.single;
        expect(sent.operation.operationName, 'Menu');
        expect(sent.variables['householdId'], 'household-1');
        expect(
          sent.variables['weekStartDate'],
          weekStartDate.toUtc().toIso8601String(),
        );
      },
    );

    test('returns null when the server has no menu for that week yet — not an error', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': menuQueryWireData(menu: null)},
      );

      final Menu? result = await subject.repository.fetchMenu(
        'household-1',
        DateTime.utc(2026, 9, 7),
      );
      expect(result, isNull);
    });

    test(
      'maps a real menu, including a hydrated item and its recipe',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': menuQueryWireData(
              menu: menuWireNode(
                items: <Map<String, dynamic>>[
                  menuItemWireNode(
                    dayOfWeek: 2,
                    mealSlot: 'dinner',
                    slotRole: 'carb',
                    recipe: menuRecipeWireNode(title: 'Chapati', role: 'carb'),
                  ),
                ],
              ),
            ),
          },
        );

        final Menu? result = await subject.repository.fetchMenu(
          'household-1',
          DateTime.utc(2026, 9, 7),
        );

        expect(result, isNotNull);
        expect(result!.items, hasLength(1));
        final MenuItem item = result.items.single;
        expect(item.dayOfWeek, 2);
        expect(item.mealSlot, 'dinner');
        expect(item.slotRole, RecipeRole.carb);
        expect(item.recipe.title, 'Chapati');
      },
    );

    test('a ForbiddenError from a non-member surfaces as such', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('FORBIDDEN', 'You are not a member of this household.'),
      );

      await expectLater(
        subject.repository.fetchMenu('household-1', DateTime.utc(2026, 9, 7)),
        throwsA(isA<ForbiddenError>()),
      );
    });
  });

  group('FerryMenuRepository.createMenu', () {
    test('sends the CreateMenu mutation and maps the returned menu', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': createMenuWireData()},
      );

      final Menu result = await subject.repository.createMenu(
        'household-1',
        DateTime.utc(2026, 9, 7),
      );

      expect(
        subject.link.requests.single.operation.operationName,
        'CreateMenu',
      );
      expect(result.id, 'menu-1');
    });

    test('is idempotent: a second call for the same household+week returns the SAME menu id', () async {
      // The server enforces the actual idempotency (ON CONFLICT DO UPDATE,
      // W9 S2) — this asserts the repository just passes that server
      // response through unchanged on a repeat call, not a second,
      // different id.
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': createMenuWireData()},
      );

      final Menu first = await subject.repository.createMenu(
        'household-1',
        DateTime.utc(2026, 9, 7),
      );
      final Menu second = await subject.repository.createMenu(
        'household-1',
        DateTime.utc(2026, 9, 7),
      );

      expect(second.id, first.id);
      expect(subject.link.requests, hasLength(2));
    });
  });

  group('FerryMenuRepository.addMenuItem', () {
    test('sends the AddMenuItem mutation with the full input and maps the returned item', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': addMenuItemWireData()},
      );

      final NewMenuItem draft = NewMenuItem(
        recipeId: 'recipe-1',
        dayOfWeek: 1,
        mealSlot: 'lunch',
        slotRole: RecipeRole.sabziDal,
        servingsOverride: 6,
      );
      final MenuItem result = await subject.repository.addMenuItem(
        'menu-1',
        draft,
      );

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'AddMenuItem');
      expect(sent.variables['menuId'], 'menu-1');
      final Map<String, dynamic> input =
          sent.variables['input'] as Map<String, dynamic>;
      expect(input['recipeId'], 'recipe-1');
      expect(input['dayOfWeek'], 1);
      expect(input['mealSlot'], 'lunch');
      expect(input['slotRole'], 'sabzi_dal');
      expect(input['servingsOverride'], 6);
      expect(result.id, 'menu-item-1');
    });

    test(
      'a cap-rejection surfaces as a typed AppError, not swallowed',
      () async {
        final subject = _subject(
          (Request _) => _errorBody('CONFLICT', 'This meal slot is full.'),
        );

        await expectLater(
          subject.repository.addMenuItem(
            'menu-1',
            NewMenuItem(
              recipeId: 'recipe-1',
              dayOfWeek: 1,
              mealSlot: 'lunch',
              slotRole: RecipeRole.sabziDal,
            ),
          ),
          throwsA(isA<ConflictError>()),
        );
      },
    );
  });

  group('FerryMenuRepository.removeMenuItem', () {
    test(
      'sends the RemoveMenuItem mutation and returns the boolean result',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': removeMenuItemWireData(result: true),
          },
        );

        final bool result = await subject.repository.removeMenuItem(
          'menu-item-1',
        );

        expect(
          subject.link.requests.single.operation.operationName,
          'RemoveMenuItem',
        );
        expect(subject.link.requests.single.variables['id'], 'menu-item-1');
        expect(result, isTrue);
      },
    );

    test(
      'returns false for a nonexistent/already-removed id, never an error',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': removeMenuItemWireData(result: false),
          },
        );

        final bool result = await subject.repository.removeMenuItem(
          'menu-item-1',
        );
        expect(result, isFalse);
      },
    );
  });

  group('FerryMenuRepository.autoFillPreview', () {
    test('sends the AutoFillPreview query with menuId, maps items/filledCount/unfilledSlots', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': autoFillPreviewWireData(
            items: <Map<String, dynamic>>[
              proposedMenuItemWireNode(
                recipeId: 'recipe-1',
                dayOfWeek: 0,
                mealSlot: 'lunch',
                slotRole: 'carb',
              ),
            ],
            unfilledSlots: <Map<String, dynamic>>[
              unfilledSlotWireNode(
                dayOfWeek: 1,
                mealSlot: 'lunch',
                slotRole: 'sabzi_dal',
              ),
            ],
          ),
        },
      );

      final AutoFillPreviewResult result = await subject.repository
          .autoFillPreview('menu-1');

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'AutoFillPreview');
      expect(sent.variables['menuId'], 'menu-1');
      expect(result.items, hasLength(1));
      expect(result.items.single.recipeId, 'recipe-1');
      expect(result.items.single.recipe.title, 'Rajma');
      expect(result.filledCount, 1);
      expect(result.unfilledSlots, hasLength(1));
      expect(result.unfilledSlots.single.dayOfWeek, 1);
      expect(result.unfilledSlots.single.slotRole, RecipeRole.sabziDal);
    });

    test('writes nothing to Ferry\'s cache — always network, matching fetchMenu\'s own NoCache contract', () async {
      // Calling twice with a fresh subject each time and asserting two
      // real network requests were sent (not one request + one cache hit)
      // is the observable proxy for FetchPolicy.NoCache from outside the
      // repository.
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': autoFillPreviewWireData()},
      );

      await subject.repository.autoFillPreview('menu-1');
      await subject.repository.autoFillPreview('menu-1');

      expect(subject.link.requests, hasLength(2));
    });

    test(
      'a partial proposal (some slots unfilled) surfaces cleanly, not an error',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': autoFillPreviewWireData(
              items: <Map<String, dynamic>>[],
              filledCount: 0,
              unfilledSlots: <Map<String, dynamic>>[unfilledSlotWireNode()],
            ),
          },
        );

        final AutoFillPreviewResult result = await subject.repository
            .autoFillPreview('menu-1');
        expect(result.items, isEmpty);
        expect(result.filledCount, 0);
        expect(result.unfilledSlots, hasLength(1));
      },
    );
  });

  group('FerryMenuRepository.autoFillWeek', () {
    test('sends the AutoFillWeek mutation with menuId/overwrite/items and maps the full result', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': autoFillWeekWireData(
            menu: menuWireNode(
              items: <Map<String, dynamic>>[menuItemWireNode()],
            ),
            filledCount: 1,
          ),
        },
      );

      final NewMenuItem draft = NewMenuItem(
        recipeId: 'recipe-1',
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.sabziDal,
      );
      final AutoFillResult result = await subject.repository.autoFillWeek(
        'menu-1',
        overwrite: true,
        items: <NewMenuItem>[draft],
      );

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'AutoFillWeek');
      expect(sent.variables['menuId'], 'menu-1');
      expect(sent.variables['overwrite'], isTrue);
      final List<dynamic> items = sent.variables['items'] as List<dynamic>;
      expect(items, hasLength(1));
      final Map<String, dynamic> sentItem =
          items.single as Map<String, dynamic>;
      expect(sentItem['recipeId'], 'recipe-1');
      expect(sentItem['mealSlot'], 'lunch');
      expect(sentItem['slotRole'], 'sabzi_dal');
      expect(result.menu.items, hasLength(1));
      expect(result.filledCount, 1);
    });

    test('an empty items list sends an empty array, not null', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': autoFillWeekWireData(filledCount: 0),
        },
      );

      await subject.repository.autoFillWeek(
        'menu-1',
        overwrite: false,
        items: const <NewMenuItem>[],
      );

      final Request sent = subject.link.requests.single;
      expect(sent.variables['items'], isEmpty);
      expect(sent.variables['overwrite'], isFalse);
    });

    test('filledCount lower than the submitted item count (a live re-validation skip) surfaces via unfilledSlots, not an error', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': autoFillWeekWireData(
            menu: menuWireNode(items: const <Map<String, dynamic>>[]),
            filledCount: 0,
            unfilledSlots: <Map<String, dynamic>>[unfilledSlotWireNode()],
          ),
        },
      );

      final AutoFillResult result = await subject.repository.autoFillWeek(
        'menu-1',
        overwrite: false,
        items: <NewMenuItem>[
          NewMenuItem(
            recipeId: 'recipe-1',
            dayOfWeek: 0,
            mealSlot: 'lunch',
            slotRole: RecipeRole.sabziDal,
          ),
        ],
      );

      expect(result.filledCount, 0);
      expect(result.unfilledSlots, hasLength(1));
    });

    test('a server rejection of the whole call surfaces as a typed AppError, not swallowed', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('FORBIDDEN', 'You are not a member of this household.'),
      );

      await expectLater(
        subject.repository.autoFillWeek(
          'menu-1',
          overwrite: false,
          items: const <NewMenuItem>[],
        ),
        throwsA(isA<ForbiddenError>()),
      );
    });
  });

  group('FerryMenuRepository.markMade', () {
    test(
      'sends the MarkMade mutation with menuItemId and maps the returned item',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{'data': markMadeWireData()},
        );

        final MenuItem result = await subject.repository.markMade(
          'menu-item-1',
        );

        final Request sent = subject.link.requests.single;
        expect(sent.operation.operationName, 'MarkMade');
        expect(sent.variables['menuItemId'], 'menu-item-1');
        expect(result.id, 'menu-item-1');
        expect(result.madeAt, isNotNull);
      },
    );

    test('a rejection on an already-made item surfaces as a typed AppError, not swallowed', () async {
      final subject = _subject(
        (Request _) => _errorBody('CONFLICT', 'This item was already made.'),
      );

      await expectLater(
        subject.repository.markMade('menu-item-1'),
        throwsA(isA<ConflictError>()),
      );
    });
  });
}
