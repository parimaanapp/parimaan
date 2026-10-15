import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';
import '../../../support/household_fixtures.dart';

/// Builds a real Ferry [Client] over a [FakeLink] — see that class's doc for
/// why this is preferred to mocking `Client` itself.
({FerryHouseholdRepository repository, FakeLink link}) _subject(
  Map<String, dynamic> Function(Request request) respond,
) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (repository: FerryHouseholdRepository(client: client), link: link);
}

/// A failed AppSync response. `data` is `null` — not `{'createHousehold':
/// null}` — because `Household!` is non-nullable, so GraphQL error propagation
/// nulls out the whole root.
Map<String, dynamic> _errorBody(String errorType, String message) =>
    <String, dynamic>{
      'data': null,
      'errors': <dynamic>[
        <String, dynamic>{
          'path': <String>['createHousehold'],
          'errorType': errorType,
          'message': message,
        },
      ],
    };

void main() {
  group('FerryHouseholdRepository.createHousehold — request', () {
    test(
      'sends the CreateHousehold operation with the name variable',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{'data': createHouseholdWireData()},
        );

        await subject.repository.createHousehold('Kulkarni Kitchen');

        expect(subject.link.requests, hasLength(1));
        final Request sent = subject.link.requests.single;
        expect(sent.operation.operationName, 'CreateHousehold');
        expect(sent.variables['name'], 'Kulkarni Kitchen');
      },
    );

    test(
      'trims the name before sending, mirroring the server-side Zod trim',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{'data': createHouseholdWireData()},
        );

        await subject.repository.createHousehold('  Kulkarni Kitchen  ');

        expect(
          subject.link.requests.single.variables['name'],
          'Kulkarni Kitchen',
        );
      },
    );

    test(
      'still calls the server for input client validation would reject — the '
      'server is the authority',
      () async {
        final subject = _subject(
          (Request _) => _errorBody('VALIDATION', 'name must not be empty'),
        );

        await expectLater(
          subject.repository.createHousehold('   '),
          throwsA(isA<ValidationError>()),
        );
        expect(subject.link.requests, hasLength(1));
      },
    );
  });

  group('FerryHouseholdRepository.createHousehold — success mapping', () {
    test('maps the wire payload to the plain-Dart domain Household', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': createHouseholdWireData()},
      );

      final Household household = await subject.repository.createHousehold(
        'Kulkarni Kitchen',
      );

      expect(household.id, 'household-1');
      expect(household.name, 'Kulkarni Kitchen');
      expect(household.inviteCode, 'ABC123');
      expect(household.primaryUserId, 'user-1');
      expect(household.subscriptionStatus, SubscriptionStatus.free);
    });

    test('maps settings, keeping AWSJSON fields as raw JSON strings', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': createHouseholdWireData()},
      );

      final Household household = await subject.repository.createHousehold(
        'Kulkarni Kitchen',
      );

      expect(household.settings.householdId, 'household-1');
      expect(household.settings.mealsEnabled, <String>[
        'breakfast',
        'lunch',
        'dinner',
      ]);
      expect(household.settings.mealStructureJson, '{"breakfast":{"items":2}}');
      expect(
        household.settings.cuisineTier2WeightsJson,
        '{"maharashtrian":0.6}',
      );
      expect(household.settings.allergens, <String>['peanut']);
    });

    test(
      'maps the caller in as the primary member with a parsed joinedAt',
      () async {
        final subject = _subject(
          (Request _) => <String, dynamic>{'data': createHouseholdWireData()},
        );

        final Household household = await subject.repository.createHousehold(
          'Kulkarni Kitchen',
        );

        expect(household.members, hasLength(1));
        final HouseholdMembership member = household.members.single;
        expect(member.role, HouseholdRole.primary);
        expect(member.joinedAt, DateTime.utc(2026, 8, 20, 9, 30));
        expect(member.user.email, 'asha@example.com');
        expect(member.user.displayName, 'Asha');
        expect(member.user.avatarUrl, isNull);
      },
    );

    test('an unrecognised server enum value maps to the unknown member, not a throw', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': createHouseholdWireData(
            subscriptionStatus: 'some_future_status',
            role: 'some_future_role',
          ),
        },
      );

      final Household household = await subject.repository.createHousehold(
        'Kulkarni Kitchen',
      );

      expect(household.subscriptionStatus, SubscriptionStatus.unknown);
      expect(household.members.single.role, HouseholdRole.unknown);
    });
  });

  group('FerryHouseholdRepository.createHousehold — error mapping', () {
    final Map<String, Matcher> cases = <String, Matcher>{
      'UNAUTHORIZED': isA<UnauthorizedError>(),
      'FORBIDDEN': isA<ForbiddenError>(),
      'VALIDATION': isA<ValidationError>(),
      'CONFLICT': isA<ConflictError>(),
      'NOT_FOUND': isA<NotFoundError>(),
      'HOUSEHOLD_FULL': isA<HouseholdFullError>(),
      'RATE_LIMITED': isA<RateLimitedError>(),
      'INTERNAL': isA<InternalError>(),
    };

    for (final MapEntry<String, Matcher> entry in cases.entries) {
      test('${entry.key} surfaces as its AppError subtype', () {
        final subject = _subject(
          (Request _) => _errorBody(entry.key, 'copy for ${entry.key}'),
        );

        expect(
          subject.repository.createHousehold('Kulkarni Kitchen'),
          throwsA(entry.value),
        );
      });
    }

    test('carries the server message through verbatim', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('VALIDATION', 'name must be at most 60 characters'),
      );

      await expectLater(
        subject.repository.createHousehold('x'),
        throwsA(
          isA<ValidationError>().having(
            (ValidationError e) => e.errorMessage,
            'errorMessage',
            'name must be at most 60 characters',
          ),
        ),
      );
    });

    test('an unrecognised errorType falls back to InternalError', () {
      final subject = _subject(
        (Request _) => _errorBody('SOME_FUTURE_ERROR', 'from a newer server'),
      );

      expect(
        subject.repository.createHousehold('Kulkarni Kitchen'),
        throwsA(isA<InternalError>()),
      );
    });

    test(
      'a link/transport failure surfaces as InternalError, not a raw exception',
      () {
        final subject = _subject(
          (Request _) => throw const _TransportFailure(),
        );

        expect(
          subject.repository.createHousehold('Kulkarni Kitchen'),
          throwsA(isA<AppError>()),
        );
      },
    );

    test('an undeserializable payload throws an AppError, not a raw '
        'built_value failure', () {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          // `createHousehold` is non-nullable, so this cannot deserialize.
          'data': <String, dynamic>{'createHousehold': null},
        },
      );

      expect(
        subject.repository.createHousehold('Kulkarni Kitchen'),
        throwsA(isA<AppError>()),
      );
    });
  });

  group('FerryHouseholdRepository.fetchMyHouseholds', () {
    test('sends the Me operation and maps each household', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': meWireData(
            households: <Map<String, dynamic>>[
              meHouseholdMembershipWireNode(),
              meHouseholdMembershipWireNode(
                membershipId: 'membership-2',
                id: 'household-2',
                name: 'Deshpande Kitchen',
                inviteCode: 'XYZ789',
                role: 'member',
              ),
            ],
          ),
        },
      );

      final List<Household> households = await subject.repository
          .fetchMyHouseholds();

      expect(subject.link.requests.single.operation.operationName, 'Me');
      expect(households, hasLength(2));
      expect(households[0].id, 'household-1');
      expect(households[0].name, 'Kulkarni Kitchen');
      expect(households[1].id, 'household-2');
      expect(households[1].name, 'Deshpande Kitchen');
    });

    test('every mapped household has an empty member list — `me.graphql` '
        'never requests members', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': meWireData(
            households: <Map<String, dynamic>>[meHouseholdMembershipWireNode()],
          ),
        },
      );

      final List<Household> households = await subject.repository
          .fetchMyHouseholds();

      expect(households.single.members, isEmpty);
    });

    test('maps settings via the shared HouseholdSettingsFields mapping', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': meWireData(
            households: <Map<String, dynamic>>[meHouseholdMembershipWireNode()],
          ),
        },
      );

      final List<Household> households = await subject.repository
          .fetchMyHouseholds();

      expect(households.single.settings.householdId, 'household-1');
      expect(
        households.single.settings.mealStructureJson,
        '{"breakfast":{"items":2}}',
      );
    });

    test('an empty households list maps to an empty list, not an error', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{'data': meWireData()},
      );

      expect(await subject.repository.fetchMyHouseholds(), isEmpty);
    });

    test('an unrecognised errorType falls back to InternalError', () {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': null,
          'errors': <dynamic>[
            <String, dynamic>{
              'path': <String>['me'],
              'errorType': 'SOME_FUTURE_ERROR',
              'message': 'from a newer server',
            },
          ],
        },
      );

      expect(
        subject.repository.fetchMyHouseholds(),
        throwsA(isA<InternalError>()),
      );
    });
  });
}

class _TransportFailure implements Exception {
  const _TransportFailure();
}
