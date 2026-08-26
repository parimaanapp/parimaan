import '../../../shared/errors/app_error.dart';

/// Turns an `AppError` from the pantry add/update/delete flows into
/// user-facing copy — same shape as `features/household/presentation/household_error_copy.dart`:
/// an exhaustive `switch` so the compiler flags this file when `AppError`
/// grows a variant, and the server's own message passed through wherever it
/// is the better sentence.
String? pantryErrorMessage(Object? error) => switch (error) {
  null => null,
  UnauthorizedError() => 'Your session has expired. Sign in again.',
  ForbiddenError(:final String errorMessage) => errorMessage,
  ValidationError(:final String errorMessage) => errorMessage,
  ConflictError(:final String errorMessage) => errorMessage,
  // The identical message a nonexistent id and an item in another household
  // both produce — see `shared/schema.graphql`'s doc on
  // `Mutation.updatePantryItem`/`deletePantryItem`. Passed through as-is,
  // not re-worded, so it stays identical to the server's own copy.
  NotFoundError(:final String errorMessage) => errorMessage,
  HouseholdFullError(:final String errorMessage) => errorMessage,
  RateLimitedError(:final String errorMessage) => errorMessage,
  InternalError(:final String errorMessage) => errorMessage,
  // Not an `AppError`. `PantryRepository`'s contract says this cannot
  // happen; rendering a Dart exception's `toString` would be worse than the
  // server's own generic sentence.
  _ => genericErrorMessage,
};
