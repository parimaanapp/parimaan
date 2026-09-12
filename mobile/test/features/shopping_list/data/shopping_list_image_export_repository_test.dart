import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_image_export_repository.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';

/// W17 S6 RED test #6 (`E2E_MVP_PLAN.md` §23.2.8 D8) — "the real repository
/// implementation calls the mutation with the correct `listId` and, given a
/// mocked successful mutation response, returns the presigned URL" (the
/// actual PUT of the bytes happens at the call site,
/// `shopping_list_share_image_screen.dart`'s own `_uploadBackup`, already
/// covered by that file's own tests — this file covers only the repository
/// half: does it call the right mutation with the right variable and return
/// the right value).
///
/// Builds a real Ferry [Client] over a [FakeLink] — same "real Client, fake
/// transport" shape `shopping_list_repository_test.dart`'s own `_subject`
/// uses, preferred to mocking `Client` itself.
({FerryShoppingListImageExportRepository repository, FakeLink link})
_subject(Map<String, dynamic> Function(Request request) respond) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (
    repository: FerryShoppingListImageExportRepository(client: client),
    link: link,
  );
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
  group('FerryShoppingListImageExportRepository.exportShoppingListImage', () {
    test(
      'sends the ExportShoppingListImage mutation with listId and returns the presigned URL straight through',
      () async {
        const String presignedUrl =
            'https://parimaan-exports-dev.s3.ap-south-1.amazonaws.com/'
            'exports/household-1/list-1/1757668800000.png'
            '?X-Amz-Signature=deadbeef';
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': <String, dynamic>{
              'exportShoppingListImage': presignedUrl,
            },
          },
        );

        final String result = await subject.repository
            .exportShoppingListImage('list-1');

        final Request sent = subject.link.requests.single;
        expect(sent.operation.operationName, 'ExportShoppingListImage');
        expect(sent.variables['listId'], 'list-1');
        expect(result, presignedUrl);
      },
    );

    test('a non-member rejection surfaces as a typed ForbiddenError, not swallowed', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('FORBIDDEN', 'You are not a member of this household.'),
      );

      await expectLater(
        subject.repository.exportShoppingListImage('list-1'),
        throwsA(isA<ForbiddenError>()),
      );
    });
  });
}
