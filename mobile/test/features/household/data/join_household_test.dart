import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';
import '../../../support/household_fixtures.dart';

/// Builds a real Ferry [Client] over a [FakeLink] — see that class's doc for
/// why this is preferred to mocking `Client` itself, and
/// `household_repository_test.dart` for the pattern this file follows.
({FerryHouseholdRepository repository, FakeLink link}) _subject(
  Map<String, dynamic> Function(Request request) respond,
) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (repository: FerryHouseholdRepository(client: client), link: link);
}

/// A failed AppSync response for a non-nullable root field. `data` is `null`
/// — not `{'joinHousehold': null}` — because GraphQL error propagation nulls
/// out the whole root when a `!` field throws.
Map<String, dynamic> _errorBody(
  String path,
  String errorType,
  String message,
) => <String, dynamic>{
  'data': null,
  'errors': <dynamic>[
    <String, dynamic>{
      'path': <String>[path],
      'errorType': errorType,
      'message': message,
    },
  ],
};

/// Every `errorType` in `api/src/errors.ts`, paired with the `AppError`
/// subtype `graphql_error_mapper.dart` must produce for it.
final Map<String, Matcher> _errorMatrix = <String, Matcher>{
  'UNAUTHORIZED': isA<UnauthorizedError>(),
  'FORBIDDEN': isA<ForbiddenError>(),
  'VALIDATION': isA<ValidationError>(),
  'CONFLICT': isA<ConflictError>(),
  'NOT_FOUND': isA<NotFoundError>(),
  'HOUSEHOLD_FULL': isA<HouseholdFullError>(),
  'RATE_LIMITED': isA<RateLimitedError>(),
  'INTERNAL': isA<InternalError>(),
  // Not in the taxonomy at all — a server that grows a ninth type must not
  // crash a client shipped before it existed.
  'SOME_FUTURE_TYPE': isA<InternalError>(),
};

void main() {
  group('FerryHouseholdRepository.joinHousehold — request', () {
    test('sends the JoinHousehold operation with the inviteCode', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': joinHouseholdWireData()},
      );

      await subject.repository.joinHousehold('K4M9PQ');

      expect(subject.link.requests, hasLength(1));
      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'JoinHousehold');
      expect(sent.variables['inviteCode'], 'K4M9PQ');
    });

    test('normalizes the code (trim + uppercase) before sending, mirroring the '
        'server-side Zod chain', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': joinHouseholdWireData()},
      );

      await subject.repository.joinHousehold('  k4m9pq  ');

      expect(subject.link.requests.single.variables['inviteCode'], 'K4M9PQ');
    });

    test(
      'still calls the server for a code client validation would reject — the '
      'server is the authority',
      () async {
        final subject = _subject(
          (Request _) => _errorBody(
            'joinHousehold',
            'VALIDATION',
            'inviteCode must be exactly 6 characters',
          ),
        );

        await expectLater(
          subject.repository.joinHousehold('ABC'),
          throwsA(isA<ValidationError>()),
        );
        expect(subject.link.requests, hasLength(1));
      },
    );
  });

  group('FerryHouseholdRepository.joinHousehold — success mapping', () {
    test('maps the wire payload to the plain-Dart domain Household', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': joinHouseholdWireData()},
      );

      final Household household = await subject.repository.joinHousehold(
        'K4M9PQ',
      );

      expect(household.id, 'household-1');
      expect(household.name, 'Kulkarni Kitchen');
      expect(household.inviteCode, 'ABC123');
      expect(household.primaryUserId, 'user-1');
      expect(household.subscriptionStatus, SubscriptionStatus.free);
    });

    test('maps the whole roster, including the caller as a member', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': joinHouseholdWireData()},
      );

      final Household household = await subject.repository.joinHousehold(
        'K4M9PQ',
      );

      expect(household.members, hasLength(2));
      expect(household.members.first.role, HouseholdRole.primary);
      expect(household.members.last.role, HouseholdRole.member);
      expect(household.members.last.user.label, 'Raj');
      // AWSDateTime is an ISO-8601 string on the wire; the custom serializer
      // is what turns it into a real DateTime.
      expect(household.members.last.joinedAt, DateTime.utc(2026, 8, 20, 9, 30));
    });

    test('keeps the AWSJSON settings fields as raw JSON strings', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': joinHouseholdWireData()},
      );

      final Household household = await subject.repository.joinHousehold(
        'K4M9PQ',
      );

      expect(household.settings.mealStructureJson, '{"breakfast":{"items":2}}');
      expect(
        household.settings.cuisineTier2WeightsJson,
        '{"maharashtrian":0.6}',
      );
    });
  });

  group('FerryHouseholdRepository.joinHousehold — error mapping', () {
    _errorMatrix.forEach((String errorType, Matcher matcher) {
      test('$errorType maps to its AppError subtype', () async {
        final subject = _subject(
          (Request _) => _errorBody('joinHousehold', errorType, 'nope'),
        );

        await expectLater(
          subject.repository.joinHousehold('K4M9PQ'),
          throwsA(matcher),
        );
      });
    });

    test(
      'HOUSEHOLD_FULL keeps the server message — the Full screen renders it',
      () async {
        final subject = _subject(
          (Request _) => _errorBody(
            'joinHousehold',
            'HOUSEHOLD_FULL',
            'This household already has the maximum number of members.',
          ),
        );

        await expectLater(
          subject.repository.joinHousehold('K4M9PQ'),
          throwsA(
            isA<HouseholdFullError>().having(
              (HouseholdFullError e) => e.errorMessage,
              'errorMessage',
              'This household already has the maximum number of members.',
            ),
          ),
        );
      },
    );

    test(
      'a transport failure becomes an InternalError, not a raw exception',
      () async {
        final subject = _subject((Request _) => throw Exception('offline'));

        await expectLater(
          subject.repository.joinHousehold('K4M9PQ'),
          throwsA(isA<InternalError>()),
        );
      },
    );

    test(
      'an error with no errorType at all becomes an InternalError',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{
            'data': null,
            'errors': <dynamic>[
              <String, dynamic>{'message': 'something went sideways'},
            ],
          },
        );

        await expectLater(
          subject.repository.joinHousehold('K4M9PQ'),
          throwsA(isA<InternalError>()),
        );
      },
    );
  });

  group('FerryHouseholdRepository.fetchHousehold', () {
    test('sends the Household query with the householdId', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': householdQueryWireData()},
      );

      await subject.repository.fetchHousehold('household-1');

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'Household');
      expect(sent.variables['householdId'], 'household-1');
    });

    test('maps the wire payload through the shared household mapper', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': householdQueryWireData(
            members: <Map<String, dynamic>>[
              householdMemberWireNode(
                membershipId: 'm-1',
                userId: 'user-1',
                role: 'primary',
                email: 'asha@example.com',
                displayName: 'Asha',
              ),
              householdMemberWireNode(
                membershipId: 'm-2',
                userId: 'user-9',
                role: 'member',
                email: 'raj@example.com',
              ),
            ],
          ),
        },
      );

      final Household household = await subject.repository.fetchHousehold(
        'household-1',
      );

      expect(household.id, 'household-1');
      expect(household.members, hasLength(2));
      // No displayName — `HouseholdMember.label` falls back to the local part
      // rather than showing a whole email address on a member list.
      expect(household.members.last.user.label, 'raj');
    });

    test(
      'does not use a cached response — the poll must hit the network',
      () async {
        int calls = 0;
        final subject = _subject((Request _) {
          calls++;
          return <String, dynamic>{
            'data': householdQueryWireData(inviteCode: 'CODE0$calls'),
          };
        });

        final Household first = await subject.repository.fetchHousehold(
          'household-1',
        );
        final Household second = await subject.repository.fetchHousehold(
          'household-1',
        );

        expect(calls, 2, reason: 'a poll that reads the cache is not a poll');
        expect(first.inviteCode, 'CODE01');
        expect(second.inviteCode, 'CODE02');
      },
    );

    _errorMatrix.forEach((String errorType, Matcher matcher) {
      test('$errorType maps to its AppError subtype', () async {
        final subject = _subject(
          (Request _) => _errorBody('household', errorType, 'nope'),
        );

        await expectLater(
          subject.repository.fetchHousehold('household-1'),
          throwsA(matcher),
        );
      });
    });
  });

  group('FerryHouseholdRepository.rotateInviteCode', () {
    test('sends the RotateInviteCode mutation with the householdId', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': rotateInviteCodeWireData()},
      );

      await subject.repository.rotateInviteCode('household-1');

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'RotateInviteCode');
      expect(sent.variables['householdId'], 'household-1');
    });

    test('returns the household carrying its new code', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': rotateInviteCodeWireData(inviteCode: 'ZY9WX8'),
        },
      );

      final Household household = await subject.repository.rotateInviteCode(
        'household-1',
      );

      expect(household.inviteCode, 'ZY9WX8');
      expect(household.id, 'household-1');
    });

    _errorMatrix.forEach((String errorType, Matcher matcher) {
      test('$errorType maps to its AppError subtype', () async {
        final subject = _subject(
          (Request _) => _errorBody('rotateInviteCode', errorType, 'nope'),
        );

        await expectLater(
          subject.repository.rotateInviteCode('household-1'),
          throwsA(matcher),
        );
      });
    });
  });

  group('FerryHouseholdRepository.leaveHousehold', () {
    test('sends the LeaveHousehold mutation with the householdId', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': leaveHouseholdWireData()},
      );

      await subject.repository.leaveHousehold('household-1');

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'LeaveHousehold');
      expect(sent.variables['householdId'], 'household-1');
    });

    test('returns the bare Boolean the mutation answers with', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': leaveHouseholdWireData()},
      );

      expect(await subject.repository.leaveHousehold('household-1'), isTrue);
    });

    test('a non-member / nonexistent household is a successful true, not an '
        'error — the mutation is idempotent server-side', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': leaveHouseholdWireData()},
      );

      expect(await subject.repository.leaveHousehold('never-existed'), isTrue);
    });

    test('the primary is refused with FORBIDDEN', () async {
      final subject = _subject(
        (Request _) => _errorBody(
          'leaveHousehold',
          'FORBIDDEN',
          'The primary member cannot leave a household. Delete the household '
              'instead.',
        ),
      );

      await expectLater(
        subject.repository.leaveHousehold('household-1'),
        throwsA(
          isA<ForbiddenError>().having(
            (ForbiddenError e) => e.errorMessage,
            'errorMessage',
            contains('primary member cannot leave'),
          ),
        ),
      );
    });

    _errorMatrix.forEach((String errorType, Matcher matcher) {
      test('$errorType maps to its AppError subtype', () async {
        final subject = _subject(
          (Request _) => _errorBody('leaveHousehold', errorType, 'nope'),
        );

        await expectLater(
          subject.repository.leaveHousehold('household-1'),
          throwsA(matcher),
        );
      });
    });
  });

  group('FerryHouseholdRepository.deleteHousehold', () {
    test('sends both variables', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': deleteHouseholdWireData()},
      );

      await subject.repository.deleteHousehold(
        'household-1',
        'Kulkarni Kitchen',
      );

      final Request sent = subject.link.requests.single;
      expect(sent.operation.operationName, 'DeleteHousehold');
      expect(sent.variables['householdId'], 'household-1');
      expect(sent.variables['confirmationName'], 'Kulkarni Kitchen');
    });

    test(
      'sends confirmationName byte-for-byte — no trim, no case folding',
      () async {
        // `api/src/resolvers/deleteHousehold.ts` compares with `!==` against
        // the stored name. Normalizing here could turn a real mismatch into a
        // match the user never typed, which for an irreversible delete is the
        // worst possible bug.
        final subject = _subject(
          (Request _) => _errorBody(
            'deleteHousehold',
            'VALIDATION',
            'confirmationName must exactly match the household name.',
          ),
        );

        await expectLater(
          subject.repository.deleteHousehold('household-1', '  kulkarni  '),
          throwsA(isA<ValidationError>()),
        );

        expect(
          subject.link.requests.single.variables['confirmationName'],
          '  kulkarni  ',
        );
      },
    );

    test('returns the bare Boolean the mutation answers with', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': deleteHouseholdWireData()},
      );

      expect(
        await subject.repository.deleteHousehold(
          'household-1',
          'Kulkarni Kitchen',
        ),
        isTrue,
      );
    });

    test('a non-primary caller is refused with FORBIDDEN', () async {
      final subject = _subject(
        (Request _) => _errorBody(
          'deleteHousehold',
          'FORBIDDEN',
          'Only the primary member can delete a household.',
        ),
      );

      await expectLater(
        subject.repository.deleteHousehold('household-1', 'Kulkarni Kitchen'),
        throwsA(isA<ForbiddenError>()),
      );
    });

    _errorMatrix.forEach((String errorType, Matcher matcher) {
      test('$errorType maps to its AppError subtype', () async {
        final subject = _subject(
          (Request _) => _errorBody('deleteHousehold', errorType, 'nope'),
        );

        await expectLater(
          subject.repository.deleteHousehold('household-1', 'Kulkarni Kitchen'),
          throwsA(matcher),
        );
      });
    });
  });
}
