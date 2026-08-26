import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item_draft.dart';
import 'package:mobile/features/pantry/domain/pantry_item_patch.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';
import '../../../support/pantry_fixtures.dart';

({FerryPantryRepository repository, FakeLink link}) _subject(
  Map<String, dynamic> Function(Request request) respond,
) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (repository: FerryPantryRepository(client: client), link: link);
}

Map<String, dynamic> _errorBody(String errorType, String message) =>
    <String, dynamic>{
      'data': null,
      'errors': <dynamic>[
        <String, dynamic>{
          'path': <String>['pantry'],
          'errorType': errorType,
          'message': message,
        },
      ],
    };

void main() {
  group('FerryPantryRepository.fetchPantry — request', () {
    test('sends the Pantry operation with the householdId variable', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': pantryQueryWireData()},
      );

      await subject.repository.fetchPantry('household-1');

      expect(subject.link.requests, hasLength(1));
      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'Pantry');
      expect(sent.variables['householdId'], 'household-1');
      expect(sent.variables['search'], isNull);
      expect(sent.variables['category'], isNull);
    });

    test('sends search and category when provided', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': pantryQueryWireData()},
      );

      await subject.repository.fetchPantry(
        'household-1',
        search: 'dal',
        category: 'grain',
      );

      final Request sent = subject.link.requests.single;
      expect(sent.variables['search'], 'dal');
      expect(sent.variables['category'], 'grain');
    });

    test(
      'a non-member gets a mapped ForbiddenError, same as fetchHousehold',
      () async {
        final subject = _subject(
          (Request _) => _errorBody('FORBIDDEN', 'You are not a member of this household.'),
        );

        await expectLater(
          subject.repository.fetchPantry('household-1'),
          throwsA(isA<ForbiddenError>()),
        );
      },
    );
  });

  group('FerryPantryRepository.fetchPantry — success mapping', () {
    test('maps the wire payload to a list of domain PantryItems', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': pantryQueryWireData(
            items: <Map<String, dynamic>>[
              pantryItemWireNode(id: 'item-1', name: 'Toor Dal'),
              pantryItemWireNode(id: 'item-2', name: 'Basmati Rice'),
            ],
          ),
        },
      );

      final result = await subject.repository.fetchPantry('household-1');

      expect(result, hasLength(2));
      expect(result[0].id, 'item-1');
      expect(result[0].name, 'Toor Dal');
      expect(result[1].id, 'item-2');
      expect(result[1].name, 'Basmati Rice');
    });

    test('maps an empty pantry to an empty list, not an error', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': pantryQueryWireData(items: <Map<String, dynamic>>[]),
        },
      );

      final result = await subject.repository.fetchPantry('household-1');
      expect(result, isEmpty);
    });
  });

  group('FerryPantryRepository.addPantryItem', () {
    const PantryItemDraft draft = PantryItemDraft(
      name: 'Toor Dal',
      quantity: 2,
      unit: 'kg',
    );

    test('sends the AddPantryItem operation with householdId and input', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': addPantryItemWireData()},
      );

      await subject.repository.addPantryItem('household-1', draft);

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'AddPantryItem');
      expect(sent.variables['householdId'], 'household-1');
      final Map<String, dynamic> input =
          sent.variables['input'] as Map<String, dynamic>;
      expect(input['name'], 'Toor Dal');
      expect(input['quantity'], 2);
      expect(input['unit'], 'kg');
    });

    test('maps the wire payload to a domain PantryItem', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': addPantryItemWireData(
            item: pantryItemWireNode(id: 'item-9', name: 'Chana Dal'),
          ),
        },
      );

      final result = await subject.repository.addPantryItem(
        'household-1',
        draft,
      );

      expect(result.id, 'item-9');
      expect(result.name, 'Chana Dal');
    });

    test('a VALIDATION failure maps to ValidationError', () async {
      final subject = _subject(
        (Request _) => _errorBody('VALIDATION', 'name must not be empty'),
      );

      await expectLater(
        subject.repository.addPantryItem('household-1', draft),
        throwsA(isA<ValidationError>()),
      );
    });
  });

  group('FerryPantryRepository.updatePantryItem', () {
    const PantryItemPatch patch = PantryItemPatch(quantity: 5);

    test('sends the UpdatePantryItem operation with id and input', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': updatePantryItemWireData()},
      );

      await subject.repository.updatePantryItem('item-1', patch);

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'UpdatePantryItem');
      expect(sent.variables['id'], 'item-1');
      final Map<String, dynamic> input =
          sent.variables['input'] as Map<String, dynamic>;
      expect(input['quantity'], 5);
      // Fields absent from the patch must be absent from the wire input
      // entirely — matching `updateHouseholdSettings`'s locked
      // absent-means-unchanged semantics, not sent as `null`.
      expect(input.containsKey('name'), isFalse);
      expect(input.containsKey('unit'), isFalse);
    });

    test('maps the wire payload to a domain PantryItem', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': updatePantryItemWireData(
            item: pantryItemWireNode(quantity: 5),
          ),
        },
      );

      final result = await subject.repository.updatePantryItem(
        'item-1',
        patch,
      );
      expect(result.quantity, 5);
    });

    test('a NOT_FOUND failure maps to NotFoundError', () async {
      final subject = _subject(
        (Request _) => _errorBody('NOT_FOUND', 'Pantry item not found.'),
      );

      await expectLater(
        subject.repository.updatePantryItem('item-1', patch),
        throwsA(isA<NotFoundError>()),
      );
    });
  });

  group('FerryPantryRepository.deletePantryItem', () {
    test('sends the DeletePantryItem operation with id', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': deletePantryItemWireData()},
      );

      await subject.repository.deletePantryItem('item-1');

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'DeletePantryItem');
      expect(sent.variables['id'], 'item-1');
    });

    test('maps the wire payload to the deleted domain PantryItem', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': deletePantryItemWireData(
            item: pantryItemWireNode(id: 'item-1'),
          ),
        },
      );

      final result = await subject.repository.deletePantryItem('item-1');
      expect(result.id, 'item-1');
    });

    test('a NOT_FOUND failure maps to NotFoundError', () async {
      final subject = _subject(
        (Request _) => _errorBody('NOT_FOUND', 'Pantry item not found.'),
      );

      await expectLater(
        subject.repository.deletePantryItem('item-1'),
        throwsA(isA<NotFoundError>()),
      );
    });
  });

  group('FerryPantryRepository.watchPantryChanges', () {
    test('sends the OnPantryChanged operation with the householdId variable', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': onPantryChangedWireData()},
      );

      await subject.repository.watchPantryChanges('household-1').first;

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'OnPantryChanged');
      expect(sent.variables['householdId'], 'household-1');
    });

    test('emits (a pure signal — the pushed item is not surfaced)', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': onPantryChangedWireData()},
      );

      await expectLater(
        subject.repository.watchPantryChanges('household-1').first,
        completes,
      );
    });

    test('a subscribe-time FORBIDDEN denial maps to ForbiddenError', () async {
      final subject = _subject(
        (Request _) => _errorBody(
          'FORBIDDEN',
          'You are not a member of this household.',
        ),
      );

      await expectLater(
        subject.repository.watchPantryChanges('household-1').first,
        throwsA(isA<ForbiddenError>()),
      );
    });
  });
}
