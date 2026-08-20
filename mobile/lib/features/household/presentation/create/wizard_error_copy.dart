import '../../../../shared/errors/app_error.dart';

/// Turns whatever landed in the wizard controller's `state.error` into copy.
///
/// Shared by all six setup screens rather than repeated on each: they all call
/// the same mutation and can all receive the same eight failures, so six
/// copies of this `switch` would be six places to forget a new variant.
///
/// Every branch is spelled out rather than collapsed to `error.errorMessage`
/// for the reason `FirstRunChoosePathScreen` gives: the exhaustive `switch` is
/// what makes the compiler point here when `AppError` grows a variant, which
/// is the entire reason the taxonomy is sealed.
///
/// The server's own messages are safe to render — `api/src/errors.ts` collapses
/// anything else to a generic `INTERNAL` before it can leave the Lambda — so
/// most branches pass them through. The two that do not:
///
///  * [UnauthorizedError] — the server's copy is about a token; the user needs
///    to know they must sign in again.
///  * [ForbiddenError] — during setup this can only mean the household went
///    away underneath the wizard (deleted, or membership revoked), which the
///    server's generic "not a member" wording does not explain.
String? wizardErrorMessage(Object? error) => switch (error) {
  null => null,
  UnauthorizedError() => 'Your session has expired. Sign in again.',
  ForbiddenError() =>
    "You're no longer a member of this household. Start setup again.",
  ValidationError(:final String errorMessage) => errorMessage,
  ConflictError(:final String errorMessage) => errorMessage,
  NotFoundError(:final String errorMessage) => errorMessage,
  HouseholdFullError(:final String errorMessage) => errorMessage,
  RateLimitedError(:final String errorMessage) => errorMessage,
  InternalError(:final String errorMessage) => errorMessage,
  // Not an `AppError` at all. `HouseholdRepository`'s contract says this
  // cannot happen; rendering a Dart exception's `toString` at a user would be
  // worse than the server's own generic sentence.
  _ => genericErrorMessage,
};
