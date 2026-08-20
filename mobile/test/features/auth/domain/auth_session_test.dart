import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';

void main() {
  group('AuthSession', () {
    test('signedOut is a const singleton-equal value', () {
      expect(const AuthSession.signedOut(), const AuthSession.signedOut());
      expect(
        const AuthSession.signedOut().hashCode,
        const AuthSession.signedOut().hashCode,
      );
    });

    test('signedIn compares by value across every field', () {
      const AuthSession a = AuthSession.signedIn(
        userId: 'u1',
        email: 'a@example.com',
        displayName: 'Asha',
        avatarUrl: 'https://example.com/a.png',
      );
      const AuthSession b = AuthSession.signedIn(
        userId: 'u1',
        email: 'a@example.com',
        displayName: 'Asha',
        avatarUrl: 'https://example.com/a.png',
      );
      const AuthSession differentUser = AuthSession.signedIn(
        userId: 'u2',
        email: 'a@example.com',
        displayName: 'Asha',
        avatarUrl: 'https://example.com/a.png',
      );

      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(a, isNot(differentUser));
    });

    test('optional display fields default to null', () {
      const SignedIn session = SignedIn(userId: 'u1', email: 'a@example.com');

      expect(session.displayName, isNull);
      expect(session.avatarUrl, isNull);
    });

    test('isSignedIn discriminates the two variants', () {
      expect(const AuthSession.signedOut().isSignedIn, isFalse);
      expect(
        const AuthSession.signedIn(userId: 'u1', email: 'a@e.com').isSignedIn,
        isTrue,
      );
    });

    test('is exhaustively switchable without a default arm', () {
      String describe(AuthSession session) => switch (session) {
        SignedOut() => 'out',
        SignedIn(:final String email) => email,
      };

      expect(describe(const AuthSession.signedOut()), 'out');
      expect(
        describe(const AuthSession.signedIn(userId: 'u', email: 'a@e.com')),
        'a@e.com',
      );
    });

    test('toString of signedIn does not leak the email address', () {
      const AuthSession session = AuthSession.signedIn(
        userId: 'u1',
        email: 'asha@example.com',
      );

      expect(session.toString(), isNot(contains('asha@example.com')));
      expect(session.toString(), contains('u1'));
    });
  });
}
