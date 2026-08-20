/// The app's own notion of "who is signed in", independent of any auth vendor.
///
/// Nothing from `amplify_*` appears in this file, and nothing should: the
/// router, the controller and every screen depend on this type, so leaking a
/// Cognito type here would make swapping the identity provider a rewrite
/// rather than a one-file change.
sealed class AuthSession {
  const AuthSession();

  const factory AuthSession.signedOut() = SignedOut;

  const factory AuthSession.signedIn({
    required String userId,
    required String email,
    String? displayName,
    String? avatarUrl,
  }) = SignedIn;

  /// Convenience for the router redirect, which only cares about the
  /// discriminant. Prefer a `switch` anywhere the payload is needed.
  bool get isSignedIn;
}

/// No credentials, or credentials that no longer resolve to a session.
final class SignedOut extends AuthSession {
  const SignedOut();

  @override
  bool get isSignedIn => false;

  @override
  String toString() => 'SignedOut()';

  @override
  bool operator ==(Object other) => other is SignedOut;

  @override
  int get hashCode => (SignedOut).hashCode;
}

/// A resolved Cognito session, flattened to the fields the UI actually uses.
///
/// [userId] is the Cognito `sub` — the same value the API's `Query.me`
/// resolver keys users on. Tokens are deliberately absent: they live in
/// Amplify's secure storage and are fetched by the (later) GraphQL client, not
/// carried around in app state where they would end up in logs.
final class SignedIn extends AuthSession {
  const SignedIn({
    required this.userId,
    required this.email,
    this.displayName,
    this.avatarUrl,
  });

  final String userId;
  final String email;
  final String? displayName;
  final String? avatarUrl;

  @override
  bool get isSignedIn => true;

  /// Email is omitted on purpose — `toString` ends up in crash reports and
  /// debug logs, and an email address there is PII we have no reason to spill.
  @override
  String toString() => 'SignedIn(userId: $userId)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SignedIn &&
          other.userId == userId &&
          other.email == email &&
          other.displayName == displayName &&
          other.avatarUrl == avatarUrl;

  @override
  int get hashCode => Object.hash(userId, email, displayName, avatarUrl);
}
