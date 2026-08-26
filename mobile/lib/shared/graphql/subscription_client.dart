import 'dart:async';
import 'dart:convert';

import 'package:gql_exec/gql_exec.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../errors/app_error.dart';
import 'appsync_realtime_protocol.dart';
import 'graphql_error_mapper.dart';

/// Matches [WebSocketChannel.connect]'s signature — the seam
/// [AppSyncSubscriptionClient] is injected through so tests never open a
/// real socket. Production leaves it at the default; tests substitute a fake
/// channel backed by their own `StreamController`s.
typedef WebSocketChannelFactory =
    WebSocketChannel Function(Uri uri, {Iterable<String>? protocols});

/// Owns **one multiplexed WebSocket connection for the whole app**
/// (E2E_MVP_PLAN.md §11.3 S8 step 2b) — every concurrent subscription shares
/// it, distinguished by AppSync's per-subscription `id`, exactly like the
/// real AppSync JS/Amplify clients do. Connects lazily on the first
/// [subscribe] call; disconnects once the last subscriber cancels.
///
/// W5 scope is deliberately narrow (§11.3 S8 step 2d): subscribe when a
/// screen starts listening, unsubscribe when it stops. No reconnect backoff
/// and no invalidate-and-refetch-on-reconnect — both are W8. A token that
/// expires mid-connection is also W8's problem: this slice reconnects with a
/// fresh token only because [subscribe] is called again by a *new*
/// `PantryController.build()`, not because this client detects expiry
/// itself.
class AppSyncSubscriptionClient {
  AppSyncSubscriptionClient({
    required this.httpGraphQlUrl,
    WebSocketChannelFactory? channelFactory,
  }) : _channelFactory = channelFactory ?? WebSocketChannel.connect;

  final String httpGraphQlUrl;
  final WebSocketChannelFactory _channelFactory;

  WebSocketChannel? _channel;
  StreamSubscription<Object?>? _channelSubscription;
  Completer<void>? _connectionAck;
  Timer? _connectTimeoutTimer;
  int _nextSubscriptionId = 0;
  final Map<String, StreamController<Response>> _subscriptions =
      <String, StreamController<Response>>{};

  /// Registers one subscription on the shared connection, opening it first
  /// if this is the only active subscriber. The returned stream emits one
  /// [Response] per pushed event (or a `Response` carrying [GraphQLError]s
  /// for a subscribe-time denial) and closes when the caller cancels it or
  /// the server sends `complete`.
  Stream<Response> subscribe({
    required String query,
    required Map<String, Object?> variables,
    required String idToken,
  }) {
    final String id = 'sub-${_nextSubscriptionId++}';
    bool cancelled = false;
    late final StreamController<Response> controller;
    controller = StreamController<Response>(
      onListen: () async {
        try {
          await _ensureConnected(idToken);
        } on Object catch (error) {
          if (!cancelled) {
            controller.addError(error);
            await controller.close();
          }
          return;
        }
        // The caller may have cancelled while the connect above was still
        // in flight — registering it now would resurrect an already-
        // unsubscribed controller, and `_channel` may since have been torn
        // down by that very cancellation (the last-subscriber-disconnects
        // path in `onCancel` below), making the `sink.add` beneath this
        // unconditionally throw. See the Flutter-review CRITICAL finding
        // this guard exists for.
        if (cancelled) {
          return;
        }
        _subscriptions[id] = controller;
        _channel!.sink.add(
          jsonEncode(
            startFrame(
              id: id,
              query: query,
              variables: variables,
              idToken: idToken,
              host: appSyncApiHost(httpGraphQlUrl),
            ),
          ),
        );
      },
      onCancel: () async {
        cancelled = true;
        _subscriptions.remove(id);
        _channel?.sink.add(jsonEncode(stopFrame(id)));
        if (_subscriptions.isEmpty) {
          await _disconnect();
        }
      },
    );
    return controller.stream;
  }

  /// Closes the connection immediately, regardless of active subscribers —
  /// the unsubscribe-on-background half of W5's scope (§11.3 S8 step 2d).
  Future<void> disconnect() => _disconnect();

  Future<void> _ensureConnected(String idToken) {
    final Completer<void>? existingAck = _connectionAck;
    if (existingAck != null) {
      // Shared by every concurrent subscriber connecting at once — whichever
      // way this settles (success, `connection_error`, or the timeout below),
      // every awaiter here observes the *same* outcome. See the Flutter-
      // review CRITICAL finding this replaced: the previous version raced a
      // per-caller `.timeout()` against this shared completer, so a second
      // subscriber could await a completer that timed out for the first
      // caller but was never itself completed — an unresolvable hang.
      return existingAck.future;
    }

    final WebSocketChannel channel = _channelFactory(
      appSyncConnectUri(httpGraphQlUrl, idToken: idToken),
      protocols: const <String>['graphql-ws'],
    );
    _channel = channel;
    final Completer<void> ack = Completer<void>();
    _connectionAck = ack;
    _channelSubscription = channel.stream.listen(
      _handleRawMessage,
      onError: _handleChannelError,
      onDone: _handleChannelDone,
    );
    channel.sink.add(jsonEncode(connectionInitFrame()));

    _connectTimeoutTimer = Timer(const Duration(seconds: 10), () {
      _failConnection(
        const InternalError('Timed out connecting to the live-updates server.'),
      );
    });
    // `.ignore()`, not `unawaited(...)`: `whenComplete` re-propagates `ack`'s
    // error into the future it returns, and that new future has no listener
    // of its own — an actual bug caught by this file's own tests, not
    // theoretical. `unawaited` only silences the "must await" lint; it does
    // nothing about an unhandled error landing in the zone. `ack.future`
    // itself is still returned below and awaited (with its error handled)
    // by every real caller.
    ack.future.whenComplete(() => _connectTimeoutTimer?.cancel()).ignore();

    return ack.future;
  }

  /// Fails the in-flight (or just-established) connection attempt for
  /// **every** awaiter of [_connectionAck] — not just whichever caller
  /// happened to trigger the underlying [_ensureConnected] call — then tears
  /// the connection down so the next [subscribe] starts a fresh attempt
  /// rather than replaying a cached failure forever (the second Flutter-
  /// review CRITICAL finding: a `connection_error` that only completed the
  /// completer, without also clearing `_channel`/`_connectionAck`, left
  /// every later `subscribe()` call permanently seeing a "connection" that
  /// was already dead).
  void _failConnection(Object error) {
    final Completer<void>? ack = _connectionAck;
    if (ack != null && !ack.isCompleted) {
      ack.completeError(error);
    }
    unawaited(_disconnect());
  }

  void _handleRawMessage(Object? raw) {
    // A malformed or unexpected-shape frame must not crash the listener —
    // an exception thrown from a `Stream.listen` `onData` callback is *not*
    // routed through `onError` (Flutter-review HIGH finding); dropping the
    // frame is the same tolerant handling already applied to unrecognised
    // `type`s below, just extended to cover "can't even be parsed".
    try {
      final Object? decoded = jsonDecode(raw as String);
      if (decoded is! Map<String, Object?>) {
        return;
      }
      switch (decoded['type']) {
        case 'connection_ack':
          _connectionAck?.complete();
        case 'connection_error':
          _failConnection(
            const InternalError('Could not connect to the live-updates server.'),
          );
        case 'data':
          _forwardData(decoded);
        case 'error':
          _forwardError(decoded);
        case 'complete':
          _forwardComplete(decoded);
        // 'ka' (keep-alive) and anything unrecognised are silently ignored —
        // AppSync's protocol allows future frame types clients don't yet know.
      }
    } on Object {
      return;
    }
  }

  void _forwardData(Map<String, Object?> message) {
    final StreamController<Response>? controller = _controllerFor(message);
    if (controller == null) {
      return;
    }
    final Object? payload = message['payload'];
    final Map<String, dynamic>? data = payload is Map<String, Object?>
        ? payload['data'] as Map<String, dynamic>?
        : null;
    controller.add(Response(data: data, response: const <String, dynamic>{}));
  }

  void _forwardError(Map<String, Object?> message) {
    final StreamController<Response>? controller = _controllerFor(message);
    if (controller == null) {
      return;
    }
    final Object? payload = message['payload'];
    final List<Object?> rawErrors = payload is Map<String, Object?>
        ? (payload['errors'] as List<Object?>? ?? const <Object?>[])
        : const <Object?>[];
    const AppSyncResponseParser parser = AppSyncResponseParser();
    final List<GraphQLError> errors = rawErrors
        .whereType<Map<String, dynamic>>()
        .map(parser.parseError)
        .toList();
    controller.add(
      Response(
        errors: errors.isEmpty ? null : errors,
        response: const <String, dynamic>{},
      ),
    );
  }

  void _forwardComplete(Map<String, Object?> message) {
    final String? id = message['id'] as String?;
    if (id == null) {
      return;
    }
    unawaited(_subscriptions.remove(id)?.close());
  }

  StreamController<Response>? _controllerFor(Map<String, Object?> message) =>
      _subscriptions[message['id'] as String?];

  /// A channel-level error (not an AppSync protocol `error` frame — an
  /// actual socket failure) tears the connection down the same way
  /// [_handleChannelDone] does. Previously this only pushed the error onto
  /// every subscriber without resetting `_subscriptions`/`_channel`/
  /// `_connectionAck` (Flutter-review HIGH finding): subscribers were left
  /// permanently unclosed unless `onDone` also happened to fire afterward
  /// (not guaranteed), and a fresh `subscribe()` in the meantime would
  /// wrongly believe the dead connection was still healthy.
  void _handleChannelError(Object error) {
    final Completer<void>? ack = _connectionAck;
    if (ack != null && !ack.isCompleted) {
      ack.completeError(error);
    }
    for (final StreamController<Response> controller in _subscriptions.values) {
      controller.addError(error);
      unawaited(controller.close());
    }
    _resetConnectionState();
  }

  void _handleChannelDone() {
    for (final StreamController<Response> controller in _subscriptions.values) {
      unawaited(controller.close());
    }
    _resetConnectionState();
  }

  void _resetConnectionState() {
    _subscriptions.clear();
    _channel = null;
    _connectionAck = null;
    _connectTimeoutTimer?.cancel();
    _connectTimeoutTimer = null;
    _channelSubscription = null;
  }

  Future<void> _disconnect() async {
    await _channelSubscription?.cancel();
    await _channel?.sink.close();
    _resetConnectionState();
  }
}
