import 'package:gql_exec/gql_exec.dart';
import 'package:gql_link/gql_link.dart';

import '../errors/app_error.dart';

/// Where this client keeps AppSync's `errorType`.
///
/// ## The finding this whole file exists for
///
/// AppSync's **direct-Lambda-resolver protocol puts `errorType` as a sibling
/// of `message`** on the GraphQL error object, not inside `extensions`:
///
/// ```json
/// { "errors": [ {
///     "path": ["createHousehold"],
///     "errorType": "VALIDATION",
///     "message": "name must not be empty",
///     "locations": [...]
/// } ] }
/// ```
///
/// That is what `api/src/resolvers/withErrorHandling.ts` produces —
/// `throw Object.assign(new Error(message), { errorType })` — and its own doc
/// comment says AppSync "recognizes a thrown error's own `errorType` property
/// (in addition to `message`) and surfaces it to the client".
///
/// **`gql_link`'s default `ResponseParser` drops it.** Its `parseError` reads
/// exactly four keys — `message`, `path`, `locations`, `extensions` — so a
/// sibling `errorType` is silently discarded and `GraphQLError` (which has no
/// `errorType` field at all) arrives carrying nothing to branch on.
///
/// The fix is entirely client-side and needs **no backend change**:
/// [AppSyncResponseParser] below lifts the top-level `errorType` into
/// `extensions` under this key, and everything downstream reads it from there.
/// [client.dart] installs that parser on the `HttpLink`, which is the single
/// place responsible for it.
const String appSyncErrorTypeKey = 'errorType';

/// A [ResponseParser] that preserves AppSync's non-standard, top-level
/// `errorType` (and `errorInfo`) by lifting them into `extensions`.
///
/// Extending the parser is `gql_link`'s own sanctioned seam for exactly this —
/// "Extend this to add non-standard behavior" is the comment on `parseError`.
/// Doing it here rather than at each call site means a `GraphQLError` anywhere
/// in the app already carries its type by the time anyone looks.
class AppSyncResponseParser extends ResponseParser {
  const AppSyncResponseParser();

  @override
  GraphQLError parseError(Map<String, dynamic> error) {
    final GraphQLError parsed = super.parseError(error);
    final Object? errorType = error[appSyncErrorTypeKey];
    final Object? errorInfo = error['errorInfo'];

    if (errorType == null && errorInfo == null) {
      return parsed;
    }

    return GraphQLError(
      message: parsed.message,
      locations: parsed.locations,
      path: parsed.path,
      extensions: <String, dynamic>{
        appSyncErrorTypeKey: ?errorType,
        'errorInfo': ?errorInfo,
        // Spread last on purpose: a spec-compliant `extensions.errorType` (if
        // a gateway ever sends one) wins over the AppSync sibling, so lifting
        // can never downgrade a better-specified response.
        ...?parsed.extensions,
      },
    );
  }
}

/// The `errorType` string carried by [error], or `null` if it has none or it
/// is not a `String`.
String? errorTypeOf(GraphQLError error) {
  final Object? value = error.extensions?[appSyncErrorTypeKey];
  return value is String ? value : null;
}

/// Maps one [GraphQLError] onto its [AppError] subtype.
///
/// Every `errorType` in `api/src/errors.ts` is covered. **Anything else —
/// including a missing or non-`String` `errorType` — becomes an
/// [InternalError] rather than throwing.** That fallback is the point: a
/// server that grows a ninth error type must not crash a client shipped
/// before it existed.
AppError mapGraphQLError(GraphQLError error) {
  final String message = error.message.isEmpty
      ? genericErrorMessage
      : error.message;

  return switch (errorTypeOf(error)) {
    'UNAUTHORIZED' => UnauthorizedError(message),
    'FORBIDDEN' => ForbiddenError(message),
    'VALIDATION' => ValidationError(message),
    'CONFLICT' => ConflictError(message),
    'NOT_FOUND' => NotFoundError(message),
    'HOUSEHOLD_FULL' => HouseholdFullError(message),
    'RATE_LIMITED' => RateLimitedError(message),
    'INTERNAL' => InternalError(message),
    _ => InternalError(message),
  };
}

/// Collapses a failed operation — GraphQL errors, a link exception, or
/// neither — into exactly one [AppError].
///
/// Precedence, and why:
///
/// 1. **The first GraphQL error.** A server-authored, typed, client-safe
///    message always beats a transport-level guess. Subsequent errors are
///    dropped: this slice's operations have a single root field, so a second
///    error would be about the same failure.
/// 2. **An [AppError] a link threw.** Ferry's `ErrorTypedLink` wraps anything
///    a link throws in a `TypedLinkException`, so `AuthLink`'s
///    [UnauthorizedError] arrives nested inside one. Unwrapped and passed
///    through by identity rather than re-classified.
/// 3. **Any other link exception** — no network, DNS failure, a 502, a body
///    that will not parse — becomes an [InternalError] with retryable copy.
///    A dedicated `NetworkError` variant is deliberately not invented here:
///    this taxonomy mirrors the server's, and adding a client-only member
///    would make the two stop lining up.
/// 4. **Nothing at all** — a response with neither data nor errors — is still
///    an [InternalError]. This function never returns null and never throws.
AppError mapOperationFailure({
  List<GraphQLError>? graphqlErrors,
  Object? linkException,
}) {
  if (graphqlErrors != null && graphqlErrors.isNotEmpty) {
    return mapGraphQLError(graphqlErrors.first);
  }

  final AppError? unwrapped = _unwrapAppError(linkException);
  if (unwrapped != null) {
    return unwrapped;
  }

  if (linkException != null) {
    return const InternalError(
      'Could not reach the server. Check your connection and try again.',
    );
  }

  return const InternalError(genericErrorMessage);
}

/// Digs an [AppError] out of however many `LinkException` wrappers Ferry and
/// `gql_link` put around it. Bounded, so a self-referential `originalException`
/// cannot spin.
AppError? _unwrapAppError(Object? exception) {
  Object? current = exception;
  for (int depth = 0; depth < 8 && current != null; depth++) {
    if (current is AppError) {
      return current;
    }
    if (current is! LinkException) {
      return null;
    }
    current = current.originalException;
  }
  return null;
}
