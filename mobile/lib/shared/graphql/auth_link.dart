import 'package:gql_exec/gql_exec.dart';
import 'package:gql_link/gql_link.dart';

import '../errors/app_error.dart';

/// Supplies the Cognito id token for the current session, or `null` when there
/// is no session to supply one from.
///
/// Injected rather than reached for so this file never imports `amplify_*`:
/// production wires it to `AuthRepository.currentIdToken`, which is the one
/// place in the app allowed to know Amplify exists (see
/// `features/auth/data/amplify_auth_repository.dart`). Tests hand it a
/// closure.
typedef IdTokenProvider = Future<String?> Function();

/// Puts `Authorization: <idToken>` on every outgoing GraphQL request.
///
/// AppSync's `AMAZON_COGNITO_USER_POOLS` authorization mode expects the **raw
/// id token** in `Authorization` — no `Bearer ` prefix (AppSync tolerates one,
/// but the canonical form is the bare token, and sending exactly one shape
/// keeps the CloudWatch logs readable).
///
/// The token is fetched per request rather than cached here: Amplify already
/// caches it and refreshes it when it is close to expiry, so caching a second
/// copy at this layer would only create a way to serve a stale one.
///
/// ## What this link deliberately does NOT do
///
/// It does not react to an `UNAUTHORIZED` response, and it does not sign the
/// user out. A link owns one request; it does not own app-wide auth state, and
/// reaching for `authController.signOut()` from in here would make every
/// GraphQL call a potential navigation event with no screen able to see it
/// coming. Instead the mapped [UnauthorizedError] propagates to whoever
/// invoked the operation.
///
/// **Callers are responsible for reacting to [UnauthorizedError]** — typically
/// a screen or controller pattern-matching the `AppError` out of its
/// `AsyncValue` and calling `ref.read(authControllerProvider.notifier)
/// .signOut()`, which bumps the router's `refreshListenable` and lands the
/// user back on `/sign-in`. No screen in this slice does that yet; the first
/// one that can meaningfully recover from it should.
///
/// The same rule applies to the "no token at all" case: this link throws
/// [UnauthorizedError] instead of sending an unauthenticated request that
/// AppSync would reject anyway, which saves a round trip against a possibly
/// cold Aurora instance — but it still only throws, and lets the caller
/// decide.
class AuthLink extends Link {
  AuthLink({required this.idTokenProvider});

  final IdTokenProvider idTokenProvider;

  /// The header AppSync reads the Cognito token from.
  static const String authorizationHeader = 'Authorization';

  @override
  Stream<Response> request(Request request, [NextLink? forward]) async* {
    if (forward == null) {
      throw const InternalError(
        'AuthLink is not a terminating link — chain an HttpLink after it.',
      );
    }

    final String? idToken = await _fetchIdToken();
    if (idToken == null || idToken.isEmpty) {
      throw const UnauthorizedError(
        'You are signed out. Sign in again to continue.',
      );
    }

    yield* forward(
      request.updateContextEntry<HttpLinkHeaders>(
        (HttpLinkHeaders? headers) => HttpLinkHeaders(
          headers: <String, String>{
            ...?headers?.headers,
            authorizationHeader: idToken,
          },
        ),
      ),
    );
  }

  /// Any failure to obtain a token — an `AuthFailure` from the repository, a
  /// platform-channel error — is an [UnauthorizedError] from the API's point
  /// of view: there is no credential to send. The original is not rethrown,
  /// because `AuthFailure`'s own doc forbids rendering its vendor wording and
  /// this value ends up in front of the user.
  Future<String?> _fetchIdToken() async {
    try {
      return await idTokenProvider();
    } on Object {
      return null;
    }
  }
}
