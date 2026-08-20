import '../domain/auth_failure.dart';

/// Maps an error parked in `AsyncError` to the short line shown to the user.
///
/// Returns `null` when nothing should be shown at all. Kept out of the widget
/// so the mapping is a pure function that can be read — and tested — without a
/// `pumpWidget`.
///
/// The two rules this encodes:
///
/// * **Cancelling is not an error.** The user closed the web view on purpose;
///   telling them "sign-in failed" would be blaming them for a deliberate act.
/// * **Never surface internals.** Configuration and unknown failures share one
///   generic line. The real detail is in [AuthFailure.cause] and goes to the
///   log, not to the screen — Cognito wording and deployment ids in UI copy
///   are both unhelpful and a small information leak.
String? authFailureMessage(Object? error) {
  if (error == null) {
    return null;
  }
  return switch (error) {
    AuthCancelled() => null,
    AuthNetworkFailure() =>
      "Couldn't connect. Check your connection and try again.",
    AuthConfigurationFailure() || AuthUnknownFailure() => _generic,
    _ => _generic,
  };
}

const String _generic = 'Something went wrong. Please try again.';
