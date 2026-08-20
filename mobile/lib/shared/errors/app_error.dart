/// The app-wide error taxonomy for **GraphQL operation failures**, mirroring
/// `api/src/errors.ts` one-for-one.
///
/// ## What this is not
///
/// This is deliberately *not* `AuthFailure`. That type is sign-in specific —
/// it describes why Cognito did not produce a session (cancelled, network,
/// misconfigured). This one describes why the *API* refused an operation, and
/// its vocabulary is the server's `errorType` strings. The two never mix: an
/// `AuthLink` that cannot obtain an id token throws [UnauthorizedError] (an
/// API-shaped failure), not an `AuthFailure`.
///
/// ## Why thrown, and why sealed
///
/// Same reasoning as `AuthFailure`'s own doc comment, and deliberately the
/// same shape so the codebase has one convention: Riverpod's `AsyncValue` is
/// already a `Result`, so wrapping repository results in a second `Result`
/// type would mean unwrapping one union to re-wrap it in another at every call
/// site. Throwing a *sealed* exception keeps exhaustive `switch` at the UI
/// boundary without the double wrapping.
///
/// ## The invariant
///
/// `graphql_error_mapper.dart` never lets a raw `GraphQLError`, `LinkException`
/// or deserialization failure escape the data layer: everything becomes one of
/// the eight variants below, with [InternalError] as the catch-all. An
/// `errorType` this build has never heard of maps to [InternalError] rather
/// than throwing — a server that grows a new error type must not crash an
/// already-shipped client.
///
/// ## Rendering
///
/// [errorMessage] is the server's own copy and **is** safe to show: every
/// `AppError` on the server side is authored to be client-safe, and
/// `toClientError` collapses anything else to a generic `INTERNAL` message
/// before it can leave the Lambda (`api/src/errors.ts`).
sealed class AppError implements Exception {
  const AppError(this.errorMessage);

  /// The server's `errorMessage`. User-renderable — see the class doc.
  final String errorMessage;

  /// The stable wire string this variant corresponds to. Matches
  /// `AppError.errorType` on the server exactly; used for logging, analytics,
  /// and the mapper's own round-trip tests.
  String get errorType;

  @override
  String toString() => '$errorType: $errorMessage';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AppError &&
          other.runtimeType == runtimeType &&
          other.errorMessage == errorMessage;

  @override
  int get hashCode => Object.hash(runtimeType, errorMessage);
}

/// The caller has no valid session, or the API rejected the one it sent.
///
/// **The link layer deliberately does not act on this.** Reacting to it — by
/// signing the user out, say — is the caller's job; see `auth_link.dart`.
final class UnauthorizedError extends AppError {
  const UnauthorizedError(super.errorMessage);

  @override
  String get errorType => 'UNAUTHORIZED';
}

/// The caller is authenticated but not permitted — typically not a member of
/// the household the operation names.
final class ForbiddenError extends AppError {
  const ForbiddenError(super.errorMessage);

  @override
  String get errorType => 'FORBIDDEN';
}

/// The server's own input validation rejected the arguments. Its message is
/// field-level and worth rendering next to the offending input.
final class ValidationError extends AppError {
  const ValidationError(super.errorMessage);

  @override
  String get errorType => 'VALIDATION';
}

/// The operation conflicts with existing state.
final class ConflictError extends AppError {
  const ConflictError(super.errorMessage);

  @override
  String get errorType => 'CONFLICT';
}

/// The named entity does not exist (or is not visible to this caller).
final class NotFoundError extends AppError {
  const NotFoundError(super.errorMessage);

  @override
  String get errorType => 'NOT_FOUND';
}

/// The household is already at `HOUSEHOLD_MEMBER_CAP` members.
final class HouseholdFullError extends AppError {
  const HouseholdFullError(super.errorMessage);

  @override
  String get errorType => 'HOUSEHOLD_FULL';
}

/// The caller has exceeded a per-caller daily attempt limit.
final class RateLimitedError extends AppError {
  const RateLimitedError(super.errorMessage);

  @override
  String get errorType => 'RATE_LIMITED';
}

/// The server's `INTERNAL` fallback, and this client's own fallback for
/// anything it cannot classify: an unrecognised `errorType`, a transport
/// failure, a response that fails to deserialize.
///
/// Its message is generic by construction — the server strips detail from
/// `INTERNAL` before it leaves the Lambda, precisely so connection strings and
/// table names cannot reach a client.
final class InternalError extends AppError {
  const InternalError(super.errorMessage);

  @override
  String get errorType => 'INTERNAL';
}

/// Fallback copy for a failure that arrives with no usable server message.
///
/// Matches the server's own generic `INTERNAL` wording so the user sees one
/// consistent sentence regardless of which side produced the fallback.
const String genericErrorMessage = 'An unexpected error occurred.';
