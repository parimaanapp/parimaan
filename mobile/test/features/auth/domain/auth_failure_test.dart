import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/domain/auth_failure.dart';

void main() {
  group('AuthFailure', () {
    test('every variant is an Exception so it can be thrown and caught', () {
      const List<AuthFailure> failures = <AuthFailure>[
        AuthCancelled(),
        AuthNetworkFailure(),
        AuthConfigurationFailure(message: 'missing pool id'),
        AuthUnknownFailure(),
      ];

      for (final AuthFailure failure in failures) {
        expect(failure, isA<Exception>());
        expect(() => throw failure, throwsA(same(failure)));
      }
    });

    test('is exhaustively switchable without a default arm', () {
      String label(AuthFailure failure) => switch (failure) {
        AuthCancelled() => 'cancelled',
        AuthNetworkFailure() => 'network',
        AuthConfigurationFailure() => 'configuration',
        AuthUnknownFailure() => 'unknown',
      };

      expect(label(const AuthCancelled()), 'cancelled');
      expect(label(const AuthNetworkFailure()), 'network');
      expect(
        label(const AuthConfigurationFailure(message: 'x')),
        'configuration',
      );
      expect(label(const AuthUnknownFailure()), 'unknown');
    });

    test('diagnosticLabel is distinct per variant', () {
      final Set<String> labels = <String>{
        const AuthCancelled().diagnosticLabel,
        const AuthNetworkFailure().diagnosticLabel,
        const AuthConfigurationFailure(message: 'x').diagnosticLabel,
        const AuthUnknownFailure().diagnosticLabel,
      };

      expect(labels, hasLength(4));
    });

    test('carries the underlying cause for logging', () {
      final StateError cause = StateError('boom');
      final StackTrace trace = StackTrace.current;
      final AuthUnknownFailure failure = AuthUnknownFailure(
        cause: cause,
        stackTrace: trace,
      );

      expect(failure.cause, same(cause));
      expect(failure.stackTrace, same(trace));
      expect(failure.toString(), contains('boom'));
    });

    test('a cause-less failure still has a readable toString', () {
      expect(const AuthCancelled().toString(), contains('cancelled'));
      expect(const AuthCancelled().toString(), isNot(contains('null')));
    });

    test('configuration failure surfaces what is misconfigured', () {
      const AuthConfigurationFailure failure = AuthConfigurationFailure(
        message: 'userPoolId is still a placeholder',
      );

      expect(failure.message, 'userPoolId is still a placeholder');
      expect(failure.toString(), contains('userPoolId is still a placeholder'));
    });
  });
}
