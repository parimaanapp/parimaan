import '../../../shared/errors/app_error.dart';

/// Turns an `AppError` from the join or settings flows into user-facing copy.
///
/// A sibling of `create/wizard_error_copy.dart` rather than a reuse of it. The
/// two differ on exactly one branch and it is the branch that matters:
/// mid-wizard, `FORBIDDEN` can only mean the half-built household went away, so
/// that file says *"start setup again"*. Here it means the caller is not (or is
/// no longer) permitted — a non-primary trying to delete, or a member reading a
/// household they have been removed from — and telling that user to restart
/// setup would be nonsense.
///
/// Everything else follows the same rules, for the same reasons: an exhaustive
/// `switch` so the compiler points here when `AppError` grows a variant, and
/// the server's own message passed through wherever it is the better sentence
/// (`api/src/errors.ts` guarantees every one of them is client-safe).
String? householdErrorMessage(Object? error) => switch (error) {
  null => null,
  UnauthorizedError() => 'Your session has expired. Sign in again.',
  ForbiddenError(:final String errorMessage) => errorMessage,
  ValidationError(:final String errorMessage) => errorMessage,
  ConflictError(:final String errorMessage) => errorMessage,
  NotFoundError(:final String errorMessage) => errorMessage,
  HouseholdFullError(:final String errorMessage) => errorMessage,
  RateLimitedError(:final String errorMessage) => errorMessage,
  InternalError(:final String errorMessage) => errorMessage,
  // Not an `AppError`. `HouseholdRepository`'s contract says this cannot
  // happen; rendering a Dart exception's `toString` would be worse than the
  // server's own generic sentence.
  _ => genericErrorMessage,
};

/// The message shown when an invite code matches no household.
///
/// `NOT_FOUND`'s server copy is accurate but terse. This flow's user has just
/// typed six characters off a screenshot, so the actionable half — *check it
/// and try again* — is worth adding.
const String noSuchInviteCodeMessage =
    'No household has that code. Check the six characters and try again.';
