import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../errors/app_error.dart';
import 'appsync_realtime_protocol.dart';
import 'graphql_error_mapper.dart';

/// Fallback keep-alive window when a `connection_ack` omits
/// `payload.connectionTimeoutMs` (not observed in practice, but the field is
/// optional per AWS's own protocol docs) — deliberately conservative, well
/// under AppSync's typical multi-minute `ka` cadence, so a genuinely dead
/// connection is caught reasonably promptly rather than assuming an unusually
/// long grace period the server never actually promised (W8 S2, §14.2.1).
const Duration _defaultKeepAliveTimeout = Duration(minutes: 2);

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

  /// The keep-alive window currently in force — the server's own
  /// `connectionTimeoutMs` once a `connection_ack` has supplied one, or
  /// [_defaultKeepAliveTimeout] until then / if it never does.
  Duration _keepAliveTimeout = _defaultKeepAliveTimeout;

  /// Reset by every inbound frame (§14.2.1's "any traffic proves liveness" —
  /// not just `ka`); expiring means the socket has gone silent without
  /// either side ever closing it (a phone entering a lift, a dead cell tower
  /// hop), which produces neither `onError` nor `onDone` on its own. Routed
  /// through [_handleChannelError] on expiry — the same path a real socket
  /// error takes — rather than a bespoke handler, so every consumer already
  /// treats "connection died" uniformly regardless of which of the two ways
  /// it happened.
  Timer? _keepAliveWatchdog;

  /// Subscription ids whose `start` frame has been confirmed by the server's
  /// `start_ack` on the *current* connection. Cleared on every reconnect
  /// (`_resetConnectionState`) — a stale acknowledgment from before a
  /// disconnect must never count after one. Not yet consumed by anything in
  /// this slice; S3 gates its reconnect-refetch signal on a resubscribe's
  /// `start_ack` actually landing, not merely on the `start` frame having
  /// been sent (§14.2.4).
  final Set<String> _acknowledgedSubscriptionIds = <String>{};

  /// Whether [id]'s `start` frame has been acknowledged on the current
  /// connection. Exposed for S3's own tests, and this slice's own — there is
  /// no other externally-observable signal that a `start_ack` was received
  /// and matched to a real, still-registered subscription.
  @visibleForTesting
  bool isSubscriptionAcknowledged(String id) =>
      _acknowledgedSubscriptionIds.contains(id);

  /// Guards every teardown path against re-entering another one while a
  /// teardown is already in flight (W8 S2 Flutter-review HIGH finding, and a
  /// second, related re-entrancy gap found on a follow-up review pass while
  /// fixing it). Two distinct hazards, both closed by the same flag:
  ///
  /// 1. Closing a subscriber's controller — which [_handleChannelError]/
  ///    [_handleChannelDone] both do — triggers that same controller's own
  ///    `onCancel` below, asynchronously, as a side effect of
  ///    `StreamController.close()`. Unguarded, `onCancel` would see
  ///    `_subscriptions` empty (this teardown already cleared it) and start
  ///    a *second*, concurrent `_disconnect()` — racing the first teardown's
  ///    own `_closeChannel()` call for which one gets to read `_channel`
  ///    before the other's `_resetConnectionState()` nulls it out from
  ///    under it.
  /// 2. [_handleChannelError] and [_handleChannelDone] can each be triggered
  ///    independently by the *same* real WebSocket abnormal closure (an
  ///    `onError` and an `onDone` firing for one underlying event is a real,
  ///    not merely theoretical, transport behaviour), or either can race the
  ///    keep-alive watchdog's own synthetic error. Unguarded, a second call
  ///    would re-iterate the *same*, not-yet-cleared `_subscriptions` map and
  ///    call `controller.addError`/`.close()` on controllers whose `.close()`
  ///    is already in flight from the first call — `StreamController` throws
  ///    a synchronous `StateError` for events added after `close()`, which
  ///    nothing here awaits or catches, surfacing as an unhandled zone error.
  ///
  /// Checked (not just set) at the very start of [_handleChannelError],
  /// [_handleChannelDone], and [_disconnect] themselves — not only inside
  /// `onCancel` — so all three teardown entry points guard against each
  /// other, not merely against `onCancel`'s own redundant `_disconnect()`.
  /// Set at the start of whichever path acquires it first; cleared by
  /// [_resetConnectionState] once that path has actually finished.
  bool _isTearingDown = false;

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
        _acknowledgedSubscriptionIds.remove(id);
        // Both skipped once a channel-error/done teardown is already
        // underway: that teardown is what closed this controller in the
        // first place (triggering this very `onCancel`), the channel is
        // already being torn down by it, and racing a second `_disconnect()`
        // against it is the bug `_isTearingDown` exists to prevent.
        if (!_isTearingDown) {
          _channel?.sink.add(jsonEncode(stopFrame(id)));
          if (_subscriptions.isEmpty) {
            await _disconnect();
          }
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
          final int? timeoutMs = connectionAckTimeoutMs(decoded);
          _keepAliveTimeout = timeoutMs != null
              ? Duration(milliseconds: timeoutMs)
              : _defaultKeepAliveTimeout;
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
        case 'start_ack':
          _handleStartAck(decoded);
        // 'ka' (keep-alive) and anything unrecognised are silently ignored —
        // AppSync's protocol allows future frame types clients don't yet know.
      }
      // Any inbound frame proves the connection is alive, not just `ka` —
      // reset unconditionally, and only after the switch above so a
      // `connection_ack` in this same call has already updated
      // `_keepAliveTimeout` to the real server-provided value before the
      // very first watchdog window is set (W8 S2, §14.2.1).
      _resetKeepAliveWatchdog();
    } on Object {
      return;
    }
  }

  void _handleStartAck(Map<String, Object?> message) {
    final String? id = message['id'] as String?;
    if (id != null && _subscriptions.containsKey(id)) {
      _acknowledgedSubscriptionIds.add(id);
    }
  }

  void _resetKeepAliveWatchdog() {
    _keepAliveWatchdog?.cancel();
    _keepAliveWatchdog = Timer(_keepAliveTimeout, _handleKeepAliveTimeout);
  }

  /// Silence past the keep-alive window — treated exactly like a real socket
  /// error (§14.2.1's whole reason for existing): `onDone`/`onError` never
  /// fire on their own for a connection that's merely gone quiet, so nothing
  /// else in this client would ever notice without this.
  void _handleKeepAliveTimeout() {
    unawaited(
      _handleChannelError(
        const InternalError('Live-updates connection timed out.'),
      ),
    );
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
  ///
  /// Also closes the real transport (W8 S2 Flutter-review HIGH finding): this
  /// used to only clear local bookkeeping via [_resetConnectionState], never
  /// [_channelSubscription]/[_channel] themselves — a gap [_disconnect]
  /// alone closed. That was comparatively low-risk while this method's only
  /// caller was a genuine `onError` from an already-dying transport, but the
  /// keep-alive watchdog (§14.2.1) can now call it while the socket is still
  /// fully open (a false-positive timeout, or a connection that has gone
  /// silent without the OS ever reporting the TCP session as closed) —
  /// leaving that socket connected indefinitely, and its still-live
  /// `StreamSubscription` free to keep calling back into this same client
  /// instance (including resetting a *new* connection's watchdog with
  /// frames that belong to the old, orphaned one) unless it is actually torn
  /// down here.
  Future<void> _handleChannelError(Object error) async {
    // A real abnormal closure can fire `onError` and `onDone` for the same
    // underlying event, and the keep-alive watchdog's own synthetic error
    // can race either — re-entering an already-in-flight teardown here would
    // re-iterate `_subscriptions` before it's cleared and call
    // `addError`/`.close()` on a controller whose `.close()` is already in
    // flight, which throws (§14.2.1's own re-entrancy finding).
    if (_isTearingDown) {
      return;
    }
    _isTearingDown = true;
    final Completer<void>? ack = _connectionAck;
    if (ack != null && !ack.isCompleted) {
      ack.completeError(error);
    }
    for (final StreamController<Response> controller in _subscriptions.values) {
      controller.addError(error);
      unawaited(controller.close());
    }
    // `_closeChannel()` reaches real I/O (`sink.close()`) that this
    // codebase's own fake test double cannot model throwing, but a real,
    // already-broken `web_socket_channel` sink can. A close failure is
    // swallowed as best-effort — there's nothing further to *do* about it,
    // and nothing awaits this method's own return for it to usefully
    // propagate to — but `_resetConnectionState()` in `finally` must still
    // run regardless: without it, a throw here would leave `_isTearingDown`
    // stuck `true` forever, turning every later teardown call into a silent
    // no-op and permanently preventing the client from ever reconnecting
    // (code-reviewer MEDIUM finding).
    try {
      await _closeChannel();
    } on Object {
      // Best-effort — see above.
    } finally {
      _resetConnectionState();
    }
  }

  Future<void> _handleChannelDone() async {
    // See the identical guard, and why it's needed, in [_handleChannelError].
    if (_isTearingDown) {
      return;
    }
    _isTearingDown = true;
    for (final StreamController<Response> controller in _subscriptions.values) {
      unawaited(controller.close());
    }
    // See [_handleChannelError] for the identical try/on/finally shape and
    // why each part of it is needed (a close failure is best-effort and
    // swallowed; the state reset must still run regardless, in `finally`).
    try {
      await _closeChannel();
    } on Object {
      // Best-effort — see [_handleChannelError].
    } finally {
      _resetConnectionState();
    }
  }

  /// Cancels the channel's own stream subscription and closes its sink —
  /// shared by every teardown path ([_handleChannelError],
  /// [_handleChannelDone], [_disconnect]) so none of them can drift back
  /// into only one of the two doing this, the way [_handleChannelError]/
  /// [_handleChannelDone] previously did neither.
  Future<void> _closeChannel() async {
    // Not awaited, deliberately: cancelling the listener and closing the
    // write side are independent, and there is nothing closing the sink
    // needs to wait on cancellation for. This also sidesteps a genuine
    // `fake_async` quirk (not a production concern — confirmed via manual
    // tracing): awaiting `.cancel()` on a subscription to a **broadcast**
    // `StreamController` never resolves inside a `fakeAsync` zone, which
    // silently hung this whole teardown chain before every one of its own
    // effects — closing the socket included — under exactly the tests this
    // slice needs to assert against.
    unawaited(_channelSubscription?.cancel());
    await _channel?.sink.close();
  }

  void _resetConnectionState() {
    _subscriptions.clear();
    _channel = null;
    _connectionAck = null;
    _connectTimeoutTimer?.cancel();
    _connectTimeoutTimer = null;
    _channelSubscription = null;
    _keepAliveWatchdog?.cancel();
    _keepAliveWatchdog = null;
    _keepAliveTimeout = _defaultKeepAliveTimeout;
    _acknowledgedSubscriptionIds.clear();
    _isTearingDown = false;
  }

  Future<void> _disconnect() async {
    // See the identical guard, and why it's needed, in [_handleChannelError]
    // — a caller of the public [disconnect] can race an already-in-flight
    // teardown the same way `onError`/`onDone` can race each other.
    if (_isTearingDown) {
      return;
    }
    _isTearingDown = true;
    // See [_handleChannelError] for the identical try/on/finally shape and
    // why each part of it is needed (a close failure is best-effort and
    // swallowed; the state reset must still run regardless, in `finally`).
    try {
      await _closeChannel();
    } on Object {
      // Best-effort — see [_handleChannelError].
    } finally {
      _resetConnectionState();
    }
  }
}
