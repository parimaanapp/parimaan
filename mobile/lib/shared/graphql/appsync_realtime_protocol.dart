/// Pure helpers for AWS AppSync's real-time subscription protocol — deliberately
/// separate from [AppSyncSubscriptionClient] (the stateful WebSocket owner) so
/// the message shapes can be tested without a socket at all.
///
/// AppSync's real-time transport is **not** the `graphql-ws` protocol Ferry
/// (and most GraphQL clients) assume — it is AWS's own subprotocol over a
/// `wss://…appsync-realtime-api…` URL, with connection and per-subscription
/// auth carried in a base64'd `header` JSON blob rather than a WebSocket
/// header (browsers/WS clients can't set arbitrary headers on the handshake).
/// No maintained Dart package implements it standalone (E2E_MVP_PLAN.md
/// §11.3 S8 step 1 research: `aws_appsync_subscription` on pub.dev is a
/// dead 2022 package speaking AppSync's *other*, MQTT-based Events API, not
/// GraphQL subscriptions; `amplify_api_dart` implements this protocol
/// correctly but only as an unexported internal of the full Amplify plugin
/// architecture, and pulling in Amplify's GraphQL client would violate this
/// codebase's own locked decision — SYSTEM_DESIGN.md §18 — that Amplify is
/// scoped to OAuth only, everything else stays hand-rolled). Hand-rolling
/// against AWS's public real-time protocol docs, referencing
/// `aws-amplify/amplify-flutter`'s implementation as a design reference
/// only (not a dependency), is the only viable path.
library;

import 'dart:convert';

/// Derives the `wss://…appsync-realtime-api…` connection URL from the
/// regular `https://…appsync-api…` GraphQL endpoint. AppSync's realtime and
/// regular API hosts differ only in that one path segment — there is no
/// separate config value for it.
Uri appSyncRealtimeUri(String httpGraphQlUrl) {
  final Uri httpUri = Uri.parse(httpGraphQlUrl);
  if (!httpUri.host.contains('appsync-api')) {
    // Fail fast rather than silently connecting to a bogus (or the plain,
    // non-realtime) host — every environment this app deploys to today is a
    // stock AppSync-issued hostname, but a future custom domain in front of
    // AppSync would otherwise make `replaceFirst` below a silent no-op.
    throw ArgumentError.value(
      httpGraphQlUrl,
      'httpGraphQlUrl',
      "expected the AppSync host to contain 'appsync-api'",
    );
  }
  final String realtimeHost = httpUri.host.replaceFirst(
    'appsync-api',
    'appsync-realtime-api',
  );
  return Uri(scheme: 'wss', host: realtimeHost, path: httpUri.path);
}

/// The `host` header value AppSync's realtime protocol expects inside the
/// base64'd auth blob — the *original* `appsync-api` host, not the realtime
/// one connected to.
String appSyncApiHost(String httpGraphQlUrl) => Uri.parse(httpGraphQlUrl).host;

/// Base64-encodes the `{host, Authorization}` blob AppSync's realtime
/// protocol requires both at connect time (as the `header` query param) and
/// on every `start` frame (as `payload.extensions.authorization`) — Cognito
/// user-pool auth carries the raw id token, no `Bearer ` prefix, matching
/// [AuthLink]'s own convention for the HTTP transport.
String appSyncAuthHeader({required String host, required String idToken}) =>
    base64Url.encode(
      utf8.encode(jsonEncode(<String, String>{'host': host, 'Authorization': idToken})),
    );

/// The connect-time query string appended to [appSyncRealtimeUri]:
/// `header` carries auth, `payload` is an empty JSON object AppSync's
/// protocol requires present but ignores its contents for a connect frame.
Uri appSyncConnectUri(String httpGraphQlUrl, {required String idToken}) {
  final Uri realtimeUri = appSyncRealtimeUri(httpGraphQlUrl);
  final String header = appSyncAuthHeader(
    host: appSyncApiHost(httpGraphQlUrl),
    idToken: idToken,
  );
  final String payload = base64Url.encode(utf8.encode('{}'));
  return realtimeUri.replace(
    queryParameters: <String, String>{'header': header, 'payload': payload},
  );
}

/// `{"type":"connection_init"}` — the first frame sent after the socket
/// opens, per AppSync's protocol; the server responds with `connection_ack`
/// (success) or `connection_error` (failure, e.g. an expired token).
Map<String, Object?> connectionInitFrame() => const <String, Object?>{
  'type': 'connection_init',
};

/// `{"id", "type":"start", "payload": {...}}` — registers one subscription
/// on the shared connection. `query`/`variables` travel as a JSON *string*
/// inside `payload.data` (not nested JSON) — this is AppSync's protocol
/// shape, not a serialization choice made here.
Map<String, Object?> startFrame({
  required String id,
  required String query,
  required Map<String, Object?> variables,
  required String idToken,
  required String host,
}) => <String, Object?>{
  'id': id,
  'type': 'start',
  'payload': <String, Object?>{
    'data': jsonEncode(<String, Object?>{'query': query, 'variables': variables}),
    'extensions': <String, Object?>{
      'authorization': <String, Object?>{'host': host, 'Authorization': idToken},
    },
  },
};

/// `{"id", "type":"stop"}` — unregisters one subscription without closing
/// the shared connection (other subscriptions on it may still be active).
Map<String, Object?> stopFrame(String id) => <String, Object?>{'id': id, 'type': 'stop'};
