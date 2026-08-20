/// Why an auth operation did not produce a session.
///
/// These are **thrown**, not returned. Rationale, since this is the codebase's
/// first async repository and the choice sets a precedent: Riverpod's
/// `AsyncValue` is already a `Result` type — it captures a thrown error into
/// `AsyncError` for free via `AsyncValue.guard`. Wrapping repository results in
/// a second `Result` type would mean unwrapping one union only to re-wrap it in
/// another at every call site. Throwing a *sealed* exception type keeps
/// exhaustive `switch` at the UI boundary (the thing a `Result` is usually
/// wanted for) without the double wrapping.
///
/// The invariant that makes this safe: `AmplifyAuthRepository` never lets a
/// vendor exception escape. Everything thrown out of the data layer is one of
/// the four variants below.
sealed class AuthFailure implements Exception {
  const AuthFailure({this.cause, this.stackTrace});

  /// The original vendor error, kept for logging only.
  ///
  /// **Never render this in the UI.** It carries Cognito/Amplify wording and,
  /// in the configuration case, deployment details. `authFailureMessage` in
  /// the presentation layer is the only sanctioned path to user-facing copy.
  final Object? cause;

  final StackTrace? stackTrace;

  /// Short, stable, machine-ish name for logs and analytics.
  String get diagnosticLabel;

  @override
  String toString() {
    final Object? cause = this.cause;
    return cause == null
        ? 'AuthFailure($diagnosticLabel)'
        : 'AuthFailure($diagnosticLabel): $cause';
  }
}

/// The user dismissed the hosted web UI. Not an error worth showing.
final class AuthCancelled extends AuthFailure {
  const AuthCancelled({super.cause, super.stackTrace});

  @override
  String get diagnosticLabel => 'cancelled';
}

/// The device could not reach Cognito. Retrying is meaningful.
final class AuthNetworkFailure extends AuthFailure {
  const AuthNetworkFailure({super.cause, super.stackTrace});

  @override
  String get diagnosticLabel => 'network';
}

/// The app is misconfigured — typically `dev_config.dart` was never filled in
/// from the CDK outputs (see `docs/RUNBOOK.md`), or the user pool was replaced
/// and the ids went stale.
///
/// This is the one failure that is a *developer* error rather than a user or
/// network one, so it carries a mandatory [message] naming what is wrong. It
/// must never be silently folded into [AuthUnknownFailure]: retrying will never
/// fix it, and without the distinction the only symptom is an opaque Cognito
/// rejection at sign-in.
final class AuthConfigurationFailure extends AuthFailure {
  const AuthConfigurationFailure({
    required this.message,
    super.cause,
    super.stackTrace,
  });

  /// Developer-facing description of what is misconfigured.
  final String message;

  @override
  String get diagnosticLabel => 'configuration';

  @override
  String toString() {
    final Object? cause = this.cause;
    return cause == null
        ? 'AuthFailure(configuration): $message'
        : 'AuthFailure(configuration): $message ($cause)';
  }
}

/// Anything not covered above. Always carries its [cause] so the real reason
/// is recoverable from logs.
final class AuthUnknownFailure extends AuthFailure {
  const AuthUnknownFailure({super.cause, super.stackTrace});

  @override
  String get diagnosticLabel => 'unknown';
}
