import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/graphql/graphql_error_mapper.dart';

/// Builds the GraphQL error object AppSync's direct-Lambda-resolver protocol
/// actually puts on the wire: `errorType` is a **sibling of `message`**, not a
/// member of `extensions`.
GraphQLError _wireError(String errorType, String message) =>
    const AppSyncResponseParser().parseError(<String, dynamic>{
      'message': message,
      'errorType': errorType,
      'path': <String>['createHousehold'],
    });

void main() {
  group('AppSyncResponseParser', () {
    test('lifts the top-level errorType into extensions', () {
      final GraphQLError error = _wireError('VALIDATION', 'nope');

      expect(error.message, 'nope');
      expect(error.extensions?[appSyncErrorTypeKey], 'VALIDATION');
    });

    test('preserves a real extensions map alongside the lifted errorType', () {
      final GraphQLError error = const AppSyncResponseParser().parseError(
        <String, dynamic>{
          'message': 'nope',
          'errorType': 'CONFLICT',
          'extensions': <String, dynamic>{'requestId': 'abc'},
        },
      );

      expect(error.extensions?['requestId'], 'abc');
      expect(error.extensions?[appSyncErrorTypeKey], 'CONFLICT');
    });

    test('leaves extensions untouched when there is no errorType', () {
      final GraphQLError error = const AppSyncResponseParser().parseError(
        <String, dynamic>{'message': 'plain graphql error'},
      );

      expect(error.extensions, isNull);
    });

    test('does not clobber an errorType already inside extensions', () {
      final GraphQLError error = const AppSyncResponseParser().parseError(
        <String, dynamic>{
          'message': 'nope',
          'extensions': <String, dynamic>{'errorType': 'FORBIDDEN'},
        },
      );

      expect(error.extensions?[appSyncErrorTypeKey], 'FORBIDDEN');
    });
  });

  group('mapGraphQLError — every errorType in the backend taxonomy', () {
    // Mirrors `api/src/errors.ts`. Adding an `AppError` subclass there without
    // adding it here is exactly the drift this table exists to catch.
    final Map<String, Type> cases = <String, Type>{
      'UNAUTHORIZED': UnauthorizedError,
      'FORBIDDEN': ForbiddenError,
      'VALIDATION': ValidationError,
      'CONFLICT': ConflictError,
      'NOT_FOUND': NotFoundError,
      'HOUSEHOLD_FULL': HouseholdFullError,
      'RATE_LIMITED': RateLimitedError,
      'AI_BUSY': AiBusyError,
      'AI_UNPARSEABLE': AiUnparseableError,
      'AI_UNAVAILABLE': AiUnavailableError,
      'AI_TIMEOUT': AiTimeoutError,
      'URL_UNREADABLE': UrlUnreadableError,
      'INTERNAL': InternalError,
    };

    for (final MapEntry<String, Type> entry in cases.entries) {
      test('${entry.key} maps to ${entry.value}', () {
        final AppError mapped = mapGraphQLError(
          _wireError(entry.key, 'server copy for ${entry.key}'),
        );

        expect(mapped.runtimeType, entry.value);
        expect(mapped.errorType, entry.key);
        expect(mapped.errorMessage, 'server copy for ${entry.key}');
      });
    }
  });

  group('mapGraphQLError — fallback', () {
    test('an unrecognised errorType falls back to InternalError', () {
      final AppError mapped = mapGraphQLError(
        _wireError('SOME_FUTURE_ERROR', 'a type this build predates'),
      );

      expect(mapped, isA<InternalError>());
      expect(mapped.errorMessage, 'a type this build predates');
    });

    test('a missing errorType falls back to InternalError', () {
      final AppError mapped = mapGraphQLError(
        const GraphQLError(message: 'no errorType at all'),
      );

      expect(mapped, isA<InternalError>());
      expect(mapped.errorMessage, 'no errorType at all');
    });

    test('a non-String errorType falls back to InternalError', () {
      final AppError mapped = mapGraphQLError(
        const GraphQLError(
          message: 'weird',
          extensions: <String, dynamic>{appSyncErrorTypeKey: 42},
        ),
      );

      expect(mapped, isA<InternalError>());
    });

    test('an empty server message falls back to generic copy', () {
      final AppError mapped = mapGraphQLError(const GraphQLError(message: ''));

      expect(mapped.errorMessage, isNotEmpty);
    });
  });

  group('mapOperationFailure', () {
    test('prefers the first GraphQL error over a link exception', () {
      final AppError mapped = mapOperationFailure(
        graphqlErrors: <GraphQLError>[
          _wireError('FORBIDDEN', 'not your household'),
          _wireError('INTERNAL', 'second error, ignored'),
        ],
      );

      expect(mapped, isA<ForbiddenError>());
      expect(mapped.errorMessage, 'not your household');
    });

    test('maps a link exception to InternalError with retryable copy', () {
      final AppError mapped = mapOperationFailure(
        linkException: ServerException(
          originalException: const SocketFailure(),
          parsedResponse: null,
        ),
      );

      expect(mapped, isA<InternalError>());
      expect(mapped.errorMessage, isNotEmpty);
    });

    test('an AppError thrown by a link passes through unchanged', () {
      const AppError thrown = UnauthorizedError('no id token');

      // Ferry's own `ErrorTypedLink` wraps anything a link throws in a
      // `TypedLinkException`, so this is the exact shape `AuthLink`'s
      // `UnauthorizedError` arrives in.
      final AppError mapped = mapOperationFailure(
        linkException: TypedLinkException(thrown, StackTrace.empty),
      );

      expect(mapped, same(thrown));
    });

    test('no errors at all still yields an InternalError, never null', () {
      expect(mapOperationFailure(), isA<InternalError>());
    });

    test('an empty error list yields an InternalError', () {
      expect(
        mapOperationFailure(graphqlErrors: const <GraphQLError>[]),
        isA<InternalError>(),
      );
    });
  });
}

/// Stand-in for a transport-level failure, so the test does not depend on
/// `dart:io`'s `SocketException` being constructible in every environment.
class SocketFailure implements Exception {
  const SocketFailure();
}
