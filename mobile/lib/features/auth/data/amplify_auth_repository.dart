import 'dart:async';
import 'dart:convert';

// Amplify also exports a type called `AuthSession`. It is hidden from both
// imports so that the bare name always means *our* domain type — the whole
// point of this file is that the vendor's vocabulary stops at its edge.
import 'package:amplify_auth_cognito/amplify_auth_cognito.dart'
    hide AuthSession;
import 'package:amplify_flutter/amplify_flutter.dart' hide AuthSession;
import 'package:flutter/foundation.dart';

import '../../../app/config/app_config.dart';
import '../domain/auth_failure.dart';
import '../domain/auth_session.dart';
import 'auth_repository.dart';

/// Cognito-backed [AuthRepository].
///
/// **This is the only file in the app allowed to know Amplify exists.** Every
/// public method funnels through [_guard], so nothing an `amplify_*` package
/// throws can escape as itself — callers only ever see [AuthFailure] subtypes.
///
/// Configuration is built in Dart from [AppConfig] rather than read from an
/// `amplifyconfiguration.dart`/`amplify_outputs.json`: there is no Amplify CLI
/// project here, the backend is hand-written CDK, and a generated-looking file
/// nothing generates is a trap for the next reader.
class AmplifyAuthRepository implements AuthRepository {
  AmplifyAuthRepository({
    required this.config,
    AmplifyClass? amplify,
    AmplifyAuthCognito Function()? pluginFactory,
  }) : _amplify = amplify ?? Amplify,
       _pluginFactory = pluginFactory ?? AmplifyAuthCognito.new;

  /// The environment this repository authenticates against.
  final AppConfig config;
  final AmplifyClass _amplify;
  final AmplifyAuthCognito Function() _pluginFactory;

  /// Guards against two concurrent callers both trying to configure.
  Future<void>? _configuration;

  // -------------------------------------------------------------------------
  // AuthRepository
  // -------------------------------------------------------------------------

  @override
  Future<AuthSession> currentSession() => _guard(() async {
    await _ensureConfigured();
    // Type deliberately inferred: naming it would require un-hiding Amplify's
    // own `AuthSession`, which is exactly the collision this file avoids.
    final cognitoSession = await _amplify.Auth.fetchAuthSession();
    if (!cognitoSession.isSignedIn) {
      return const AuthSession.signedOut();
    }
    return _readSignedInUser();
  });

  @override
  Future<AuthSession> signInWithGoogle() => _guard(() async {
    await _ensureConfigured();
    final SignInResult result = await _amplify.Auth.signInWithWebUI(
      provider: AuthProvider.google,
    );
    if (!result.isSignedIn) {
      // Cognito's hosted UI is a single step for a social IdP — there is no
      // MFA or new-password challenge on this pool — so "not signed in and no
      // exception" means the flow ended without a session.
      return const AuthSession.signedOut();
    }
    return _readSignedInUser();
  });

  @override
  Future<String?> currentIdToken() => _guard(() async {
    await _ensureConfigured();
    // Type deliberately inferred, for the same reason as `currentSession()`:
    // naming it would require un-hiding Amplify's own `AuthSession`.
    final cognitoSession = await _amplify.Auth.fetchAuthSession();
    if (cognitoSession is! CognitoAuthSession || !cognitoSession.isSignedIn) {
      return null;
    }
    // `.valueOrNull` rather than `.value`: an unauthenticated (or
    // partially-resolved) session throws from `.value`, and "no token" is a
    // normal state here, not a failure.
    return cognitoSession.userPoolTokensResult.valueOrNull?.idToken.raw;
  });

  @override
  Future<void> signOut() => _guard(() async {
    await _ensureConfigured();
    final SignOutResult result = await _amplify.Auth.signOut();
    if (result is CognitoFailedSignOut) {
      throw _translate(result.exception, StackTrace.current);
    }
  });

  @override
  Stream<AuthSession> sessionChanges() {
    final StreamController<AuthSession> controller =
        StreamController<AuthSession>.broadcast();
    StreamSubscription<AuthHubEvent>? subscription;

    controller
      ..onListen = () {
        subscription ??= _amplify.Hub.listen(
          HubChannel.Auth,
          (AuthHubEvent event) {
            unawaited(_emitForHubEvent(event, controller));
          },
          onError: (Object error, StackTrace stackTrace) {
            _log('hub error', error, stackTrace);
          },
        );
      }
      ..onCancel = () async {
        await subscription?.cancel();
        subscription = null;
      };

    return controller.stream;
  }

  Future<void> _emitForHubEvent(
    AuthHubEvent event,
    StreamController<AuthSession> controller,
  ) async {
    if (controller.isClosed) {
      return;
    }
    switch (event.type) {
      case AuthHubEventType.signedOut:
      case AuthHubEventType.sessionExpired:
      case AuthHubEventType.userDeleted:
        controller.add(const AuthSession.signedOut());
      case AuthHubEventType.signedIn:
        try {
          controller.add(await _readSignedInUser());
        } on Object catch (error, stackTrace) {
          // A Hub event is a notification, not a user-initiated call — there
          // is no screen waiting on it, so surfacing the error would only
          // clobber whatever the user is looking at. Log and hold the last
          // known state instead.
          _log('failed to resolve session after signedIn', error, stackTrace);
        }
    }
  }

  // -------------------------------------------------------------------------
  // Amplify configuration
  // -------------------------------------------------------------------------

  /// Adds the Cognito plugin and configures Amplify exactly once.
  ///
  /// Deferred rather than done in `main()` so that startup is not blocked by
  /// plugin channel setup, and so a configuration problem surfaces as an
  /// [AuthConfigurationFailure] on the sign-in screen instead of a crash
  /// before the first frame.
  Future<void> _ensureConfigured() => _configuration ??= _configure();

  Future<void> _configure() async {
    final List<String> placeholders = config.placeholderFields;
    if (placeholders.isNotEmpty) {
      // Reset so a hot-restart with a corrected config can retry.
      _configuration = null;
      throw AuthConfigurationFailure(
        message:
            'AppConfig still has placeholder values for '
            '${placeholders.join(', ')}. Transcribe the AuthStack CfnOutputs '
            'into mobile/lib/app/config/dev_config.dart — see docs/RUNBOOK.md, '
            '"Mobile build-time config".',
      );
    }

    try {
      if (!_amplify.isConfigured) {
        await _amplify.addPlugin(_pluginFactory());
        await _amplify.configure(buildAmplifyConfig(config));
      }
    } on AmplifyAlreadyConfiguredException {
      // Benign: a hot restart re-runs this against a still-configured
      // singleton. Anything else is a real configuration problem.
    } on Object catch (error, stackTrace) {
      _configuration = null;
      throw _translate(error, stackTrace);
    }
  }

  // -------------------------------------------------------------------------
  // Cognito -> domain
  // -------------------------------------------------------------------------

  Future<AuthSession> _readSignedInUser() async {
    final AuthUser user = await _amplify.Auth.getCurrentUser();
    final List<AuthUserAttribute> attributes =
        await _amplify.Auth.fetchUserAttributes();

    String? attribute(AuthUserAttributeKey key) {
      for (final AuthUserAttribute attribute in attributes) {
        if (attribute.userAttributeKey.key == key.key) {
          return attribute.value.isEmpty ? null : attribute.value;
        }
      }
      return null;
    }

    return AuthSession.signedIn(
      userId: user.userId,
      // `email` is a required attribute on this pool (auth-stack.ts) and the
      // Google IdP maps it, so the fallback should be unreachable — but an
      // empty string beats throwing on a session that is genuinely valid.
      email: attribute(AuthUserAttributeKey.email) ?? '',
      displayName: attribute(AuthUserAttributeKey.name),
      avatarUrl: attribute(AuthUserAttributeKey.picture),
    );
  }

  // -------------------------------------------------------------------------
  // Error translation
  // -------------------------------------------------------------------------

  Future<T> _guard<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on Object catch (error, stackTrace) {
      final AuthFailure failure = _translate(error, stackTrace);
      _log(failure.diagnosticLabel, error, stackTrace);
      throw failure;
    }
  }

  /// Maps every Amplify exception we can meet onto an [AuthFailure].
  ///
  /// Ordering matters: [UserCancelledException] and [NetworkException] are
  /// checked before the general [AuthException] arm, because both are
  /// subtypes of it and a broad match first would collapse them into
  /// "unknown".
  AuthFailure _translate(Object error, StackTrace stackTrace) {
    if (error is AuthFailure) {
      return error;
    }
    return switch (error) {
      UserCancelledException() => AuthCancelled(
        cause: error,
        stackTrace: stackTrace,
      ),
      NetworkException() => AuthNetworkFailure(
        cause: error,
        stackTrace: stackTrace,
      ),
      ConfigurationError() => AuthConfigurationFailure(
        message: error.message,
        cause: error,
        stackTrace: stackTrace,
      ),
      AmplifyAlreadyConfiguredException() => AuthConfigurationFailure(
        message: error.message,
        cause: error,
        stackTrace: stackTrace,
      ),
      // A signed-out session is a normal state, not a failure — but if it
      // arrives as an exception from a call that assumed a session, the honest
      // mapping is "unknown", not "network".
      SignedOutException() => AuthUnknownFailure(
        cause: error,
        stackTrace: stackTrace,
      ),
      SessionExpiredException() => AuthUnknownFailure(
        cause: error,
        stackTrace: stackTrace,
      ),
      AuthException() => AuthUnknownFailure(
        cause: error,
        stackTrace: stackTrace,
      ),
      AmplifyException() => AuthUnknownFailure(
        cause: error,
        stackTrace: stackTrace,
      ),
      TimeoutException() => AuthNetworkFailure(
        cause: error,
        stackTrace: stackTrace,
      ),
      _ => AuthUnknownFailure(cause: error, stackTrace: stackTrace),
    };
  }

  void _log(String label, Object error, StackTrace stackTrace) {
    // Structured logging (PostHog / CloudWatch) arrives in a later slice; until
    // then the detail must at least not be silently dropped.
    if (kDebugMode) {
      debugPrint('[auth] $label: $error\n$stackTrace');
    }
  }
}

/// Builds the Amplify Gen-1 configuration document from typed [AppConfig].
///
/// Exposed (rather than private) so it can be asserted on directly — the shape
/// of this JSON is the single most fragile, least type-checked part of the
/// integration.
///
/// The redirect URIs are literals rather than config fields on purpose: they
/// are compiled into the iOS `CFBundleURLSchemes` entry and the Android
/// `intent-filter`, and must equal the `callbackUrls` / `logoutUrls` in
/// `infra/stacks/auth-stack.ts`. Making them configurable would let three
/// places drift apart with no failure until a real device runs the flow.
String buildAmplifyConfig(AppConfig config) {
  return jsonEncode(<String, Object?>{
    'UserAgent': 'aws-amplify-cli/2.0',
    'Version': '1.0',
    'auth': <String, Object?>{
      'plugins': <String, Object?>{
        'awsCognitoAuthPlugin': <String, Object?>{
          'UserAgent': 'aws-amplify-cli/0.1.0',
          'Version': '0.1.0',
          'CognitoUserPool': <String, Object?>{
            'Default': <String, Object?>{
              'PoolId': config.userPoolId,
              'AppClientId': config.mobileClientId,
              'Region': config.region,
            },
          },
          'Auth': <String, Object?>{
            'Default': <String, Object?>{
              // The pool has no interactive native auth flow at all
              // (GOOGLE_ONLY_AUTH_FLOWS in auth-stack.ts leaves only
              // ALLOW_REFRESH_TOKEN_AUTH), so this key is inert. Amplify
              // requires it to be present and parseable.
              'authenticationFlowType': 'USER_SRP_AUTH',
              'OAuth': <String, Object?>{
                'WebDomain': config.cognitoWebDomain,
                'AppClientId': config.mobileClientId,
                'SignInRedirectURI': signInRedirectUri,
                'SignOutRedirectURI': signOutRedirectUri,
                // `aws.cognito.signin.user.admin` is not optional: it's what
                // `_readSignedInUser`'s `getCurrentUser()`/
                // `fetchUserAttributes()` calls need on the access token to
                // call Cognito's `GetUser` API after Hosted UI sign-in — the
                // Cognito app client itself already *allows* this scope
                // (`OAUTH_SCOPES` in `infra/stacks/auth-stack.ts`), but a
                // client only ever gets a token carrying the scopes it
                // actually *requests* here, so this list has to match that
                // one. Omitting it here (as an earlier version of this file
                // did) produces a token that Cognito's own app-client config
                // would have permitted, but that Amplify's own post-sign-in
                // calls then reject as insufficiently scoped — a real device
                // sign-in is the only thing that exercises the actual
                // authorize-request scope list end to end.
                'Scopes': <String>[
                  'email',
                  'openid',
                  'profile',
                  'aws.cognito.signin.user.admin',
                ],
              },
            },
          },
        },
      },
    },
  });
}

/// Must equal `callbackUrls` in `infra/stacks/auth-stack.ts`.
const String signInRedirectUri = 'parimaan://auth';

/// Must equal `logoutUrls` in `infra/stacks/auth-stack.ts`.
const String signOutRedirectUri = 'parimaan://logout';
