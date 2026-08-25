import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
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
}
