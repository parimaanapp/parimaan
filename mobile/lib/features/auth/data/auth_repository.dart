import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/auth_failure.dart';
import '../domain/auth_session.dart';

/// The app's whole auth surface, vendor-free.
///
/// **Error contract:** every method throws a subtype of [AuthFailure] and
/// nothing else. Implementations are responsible for translating vendor
/// exceptions at their own boundary — see the rationale on [AuthFailure] for
/// why this throws rather than returning a `Result`.
abstract interface class AuthRepository {
  /// Resolves the persisted session on cold start, without any UI.
  /// Returns [SignedOut] when there is nothing to restore — that is a normal
  /// outcome, not a failure.
  Future<AuthSession> currentSession();

  /// Opens the Cognito Hosted UI against the Google IdP and completes with the
  /// resulting session. Throws [AuthCancelled] if the user backs out.
  Future<AuthSession> signInWithGoogle();

  /// The current Cognito **id token**, or `null` when there is no session.
  ///
  /// This is the one credential the GraphQL layer needs (AppSync's
  /// `AMAZON_COGNITO_USER_POOLS` authorization mode reads it from
  /// `Authorization`), and it lives here rather than on [AuthSession] on
  /// purpose: `auth_session.dart` deliberately carries no tokens, because app
  /// state ends up in logs and crash reports. Exposing it as a *call* keeps
  /// the token in Amplify's secure storage and lets Amplify refresh it, while
  /// still giving `shared/graphql/auth_link.dart` a vendor-free seam to fetch
  /// it through — see that file's `IdTokenProvider`.
  ///
  /// Returns `null` rather than throwing for the ordinary signed-out case.
  /// Genuine failures still throw an [AuthFailure], like every other method
  /// here.
  Future<String?> currentIdToken();

  /// Clears the local session (and the hosted-UI session where the platform
  /// supports it). Completing normally always leaves the app signed out.
  Future<void> signOut();

  /// Sessions pushed from outside an explicit call — token expiry, sign-out
  /// triggered on another surface, a completed redirect. Backed by Amplify's
  /// Hub in the real implementation.
  ///
  /// Broadcast-style: may have zero or more listeners, and does not replay.
  Stream<AuthSession> sessionChanges();
}

/// Injection point for [AuthRepository].
///
/// Intentionally has no default: the only real implementation needs an
/// [AppConfig] and platform channels, so a default would either hardcode
/// config here or silently work in tests that meant to use a fake. The
/// composition root (`main.dart`) overrides it with `AmplifyAuthRepository`;
/// tests override it with a `MockAuthRepository`.
final Provider<AuthRepository>
authRepositoryProvider = Provider<AuthRepository>(
  (Ref ref) => throw UnimplementedError(
    'authRepositoryProvider must be overridden — see main.dart (production) '
    'or test/support/fake_auth_repository.dart (tests).',
  ),
);
