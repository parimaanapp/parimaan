import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../errors/app_error.dart';
import 'appsync_realtime_protocol.dart';
import 'auth_link.dart';
import 'graphql_error_mapper.dart';
import 'reconnect_policy.dart';

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
typedef WebSocketChannelFactory = WebSocketChannel Function(
  Uri uri, {
  Iterable<String>? protocols,
});

/// [AppSyncSubscriptionClient]'s own connection lifecycle. A plain
/// [ValueListenable] — not a Riverpod provider, and W8 has no UI consumer of
/// it (§14.2.12, D10: the offline-banner wireframe that will consume this is
/// a later week's work). Exposed now anyway, since this class is the only
/// place that actually knows this state; retrofitting an observable onto its
/// state machine later would be a far more invasive change than exposing the
/// value it already tracks internally.
enum ConnectionState { disconnected, connecting, connected }

/// Owns **one multiplexed WebSocket connection for the whole app**
/// (E2E_MVP_PLAN.md §11.3 S8 step 2b) — every concurrent subscription shares
/// it, distinguished by AppSync's per-subscription `id`, exactly like the
/// real AppSync JS/Amplify clients do. Connects lazily on the first
/// [subscribe] call; disconnects once the last subscriber cancels.
///
/// W8 S3 adds reconnect-with-backoff (§14.2.2/§14.3 S3): when an
/// **established** connection dies, subscriber streams survive the
/// disconnect — the inverse of W5's original contract, which closed them
/// immediately — and this client retries with [ReconnectPolicy]'s ladder,
/// re-fetching a fresh token via the injected [idTokenProvider] for every
/// attempt (a stale token cached from the original `subscribe()` call is
/// never reused), resubscribing every still-registered id, and emitting
/// exactly one synthetic refetch event per subscription once its resubscribe
/// is acknowledged (§14.2.4 — a push while disconnected is otherwise lost,
/// so the client cannot assume its local state is current after a gap). A
/// null token, or a `connection_error` against a freshly-fetched token, is
/// treated as an unrecoverable auth failure: the ladder stops and every
/// subscriber closes with [UnauthorizedError] rather than retrying forever
/// against a credential that will never become valid on its own.
///
/// W8 S4 adds app-lifecycle wiring (§14.3 S4): [disconnect] and
/// [reconnectNow] are the two entry points the app-root lifecycle observer
/// (`subscription_lifecycle_observer.dart`) drives — background calls
/// [disconnect], foreground calls [reconnectNow]. The two are serialized
/// against each other (see [_enqueueLifecycleOperation]) since a rapid
/// background/foreground pair can otherwise arrive faster than either call's
/// own async teardown/connect settles.
class AppSyncSubscriptionClient {
  AppSyncSubscriptionClient({
    required this.httpGraphQlUrl,
    required IdTokenProvider idTokenProvider,
    WebSocketChannelFactory? channelFactory,
    ReconnectPolicy? reconnectPolicy,
  })
    // Not an initializing formal: an initializing formal's parameter name
    // must match the field name exactly, which would force every call site
    // to pass `_idTokenProvider:` — an unusable, privacy-defeating named
    // argument. See the identical precedent and reasoning in
    // `HouseholdSyncPolicy`'s own constructor.
    // ignore: prefer_initializing_formals
    : _idTokenProvider = idTokenProvider,
       _channelFactory = channelFactory ?? WebSocketChannel.connect,
       _reconnectPolicy = reconnectPolicy ?? ReconnectPolicy();

  final String httpGraphQlUrl;
  final IdTokenProvider _idTokenProvider;
  final WebSocketChannelFactory _channelFactory;
  final ReconnectPolicy _reconnectPolicy;

  /// Serializes the two *externally callable* lifecycle entry points,
  /// [disconnect] and [reconnectNow] — the only two calls the app-lifecycle
  /// observer (W8 S4) issues, and the ones a rapid background/foreground/
  /// background sequence can otherwise interleave. Both `_isConnected` and
  /// `_isTearingDown` only settle once a teardown's own async close actually
  /// finishes; without this queue, a `reconnectNow()` call arriving while an
  /// immediately-preceding `disconnect()` is still mid-close would read
  /// `_isConnected` as still `true` (not yet reset) and silently no-op,
  /// permanently swallowing the foreground signal it was supposed to act on.
  /// Internal, teardown-triggered reconnects (the ladder's own `Timer`) are
  /// deliberately not queued through here — those already serialize
  /// correctly against each other via `_isTearingDown`, and are never
  /// triggered by two calls arriving back-to-back with no elapsed time the
  /// way a lifecycle callback pair can.
  Future<void> _lifecycleOperationQueue = Future<void>.value();

  Future<void> _enqueueLifecycleOperation(Future<void> Function() operation) {
    final Future<void> result = _lifecycleOperationQueue.then(
      (_) => operation(),
    );
    // Swallow so one failed operation doesn't poison the queue for the next
    // — the caller of *this* call still observes the real result via
    // `result`, returned below.
    _lifecycleOperationQueue = result.catchError((Object _) {});
    return result;
  }

  WebSocketChannel? _channel;
  StreamSubscription<Object?>? _channelSubscription;
  Completer<void>? _connectionAck;
  Timer? _connectTimeoutTimer;
  int _nextSubscriptionId = 0;
  final Map<String, _SubscriptionRegistration> _subscriptions =
      <String, _SubscriptionRegistration>{};

  /// True once `connection_ack` has landed for the *current* connection
  /// episode. Captured before a teardown resets it — that captured value is
  /// what decides whether a dying connection is a fresh-connect failure
  /// (already surfaced to its own caller via [subscribe]'s own `onListen`
  /// catch, nothing further to do) or an established connection dying, which
  /// is what should actually trigger [_scheduleReconnect].
  bool _isConnected = false;

  Timer? _reconnectTimer;

  /// Subscription ids currently mid-resubscribe after a reconnect — a
  /// `start_ack` for one of these means "this id is back," which is when the
  /// synthetic refetch event fires (§14.2.4). Deliberately separate from
  /// [_acknowledgedSubscriptionIds]: a subscription's very first-ever
  /// `start_ack` must never trigger a refetch (there is nothing to have
  /// missed before the first fetch), only a *re*-acknowledgment after a gap.
  final Set<String> _pendingRefetchAcks = <String>{};

  final ValueNotifier<ConnectionState> _connectionState =
      ValueNotifier<ConnectionState>(ConnectionState.disconnected);

  /// See [ConnectionState]'s own doc.
  ValueListenable<ConnectionState> get connectionState => _connectionState;

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
  /// disconnect must never count after one.
  final Set<String> _acknowledgedSubscriptionIds = <String>{};

  /// Whether [id]'s `start` frame has been acknowledged on the current
  /// connection. Exposed for this file's own tests — there is no other
  /// externally-observable signal that a `start_ack` was received and
  /// matched to a real, still-registered subscription.
  @visibleForTesting
  bool isSubscriptionAcknowledged(String id) =>
      _acknowledgedSubscriptionIds.contains(id);

  /// Guards every teardown path against re-entering another one while a
  /// teardown is already in flight (W8 S2 Flutter-review HIGH finding, and a
  /// second, related re-entrancy gap found on a follow-up review pass while
  /// fixing it). Two distinct hazards, both closed by the same flag:
  ///
  /// 1. Closing a subscriber's controller — which [_handleChannelError]/
  ///    [_handleChannelDone] both did in W8 S2 — triggers that same
  ///    controller's own `onCancel` below, asynchronously, as a side effect
  ///    of `StreamController.close()`. Unguarded, `onCancel` would see
  ///    `_subscriptions` empty (a teardown already cleared it) and start a
  ///    *second*, concurrent `_disconnect()` — racing the first teardown's
  ///    own `_closeChannel()` call for which one gets to read `_channel`
  ///    before the other's `_resetConnectionState()` nulls it out from
  ///    under it.
  /// 2. [_handleChannelError] and [_handleChannelDone] can each be triggered
  ///    independently by the *same* real WebSocket abnormal closure (an
  ///    `onError` and an `onDone` firing for one underlying event is a real,
  ///    not merely theoretical, transport behaviour), or either can race the
  ///    keep-alive watchdog's own synthetic error.
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
  /// for a subscribe-time denial) and stays open across a transient
  /// disconnect (W8 S3, §14.2.2) — it only closes when the caller cancels
  /// it, the server sends `complete`, or reconnection fails terminally.
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
        } on _ConnectAbortedByDisconnect {
          // Never surfaced verbatim — see [_ConnectAbortedByDisconnect]'s
          // own doc. A public, generic error: the caller (a screen whose
          // subscribe raced an app-background event) gets a real,
          // actionable failure rather than a silently hanging stream.
          if (!cancelled) {
            controller.addError(
              const InternalError(
                'Disconnected before the connection was established.',
              ),
            );
            await controller.close();
          }
          return;
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
        _subscriptions[id] = _SubscriptionRegistration(
          controller: controller,
          query: query,
          variables: variables,
        );
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
        _pendingRefetchAcks.remove(id);
        if (_subscriptions.isEmpty) {
          // Nobody left to reconnect for — a pending backoff timer firing
          // later would otherwise fetch a fresh token and reconnect for no
          // listener at all (§14.3 S3's own cancellation-during-backoff
          // case). `_attemptReconnect` itself also checks this, so this is
          // a hygiene improvement, not the only thing preventing it.
          _reconnectTimer?.cancel();
          _reconnectTimer = null;
        }
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

  /// Closes the connection immediately, regardless of active subscribers.
  /// Subscriptions themselves are **not** removed (W8 S3, §14.2.2's inverted
  /// close contract) — only the transport is torn down. The app-lifecycle
  /// observer (W8 S4) relies on this to mean "network gone, listeners
  /// intact," not "everyone must resubscribe from scratch."
  ///
  /// Aborts any in-flight connect attempt **immediately**, ahead of
  /// [_enqueueLifecycleOperation]'s own queue position — otherwise a
  /// `disconnect()` arriving while a queued [reconnectNow]'s own handshake
  /// is still pending would sit behind it for up to the full connect
  /// timeout before the transport actually starts tearing down, undercutting
  /// the whole point of backgrounding (a live socket left trying to connect
  /// in the background is exactly the battery/Aurora-load cost this class
  /// exists to avoid — code-reviewer MEDIUM finding). The actual teardown
  /// (closing the socket, resetting state) still goes through the queue as
  /// before, so it only runs once whatever operation was ahead of it has
  /// genuinely finished.
  Future<void> disconnect() {
    final Completer<void>? ack = _connectionAck;
    if (ack != null && !ack.isCompleted) {
      ack.completeError(const _ConnectAbortedByDisconnect());
    }
    return _enqueueLifecycleOperation(_disconnect);
  }

  /// Forces an immediate reconnect attempt for every still-registered
  /// subscription, bypassing any pending backoff wait and resetting
  /// [ReconnectPolicy] back to its first rung (W8 S4, §14.3 S4) — the
  /// app-foreground case: a user who reopens the app after any length of
  /// time in the background deserves an immediate retry, not whatever rung
  /// the ladder happened to be sitting on when it was backgrounded. Queued
  /// against [disconnect] — see [_enqueueLifecycleOperation].
  ///
  /// A no-op in the cases that would otherwise do something wrong: no
  /// registered subscriptions at all (nothing to reconnect for — mirrors
  /// [_attemptReconnect]'s own guard, and covers "foreground with no active
  /// subscriptions opens no connection"), or a connection that is already
  /// established *or already being attempted* (`_connectionAck != null`
  /// covers both — calling this while genuinely still connected would still
  /// route through [_ensureConnected]'s shared-completer reuse and open no
  /// *second* transport, but it would needlessly re-issue a `start` frame
  /// and a synthetic refetch for every subscription that never actually
  /// lost its connection at all; calling it while a connect attempt — the
  /// ladder's own non-queued `_attemptReconnect()`, triggered independently
  /// by its `Timer` — is already in flight would instead race a *second*,
  /// concurrent `_attemptReconnect()` against it, both eventually
  /// re-subscribing every id and sending duplicate `start` frames once the
  /// shared completer resolves — flutter-review HIGH finding).
  Future<void> reconnectNow() => _enqueueLifecycleOperation(_reconnectNow);

  Future<void> _reconnectNow() async {
    if (_subscriptions.isEmpty || _connectionAck != null) {
      return;
    }
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconnectPolicy.reset();
    await _attemptReconnect();
  }

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

    _connectionState.value = ConnectionState.connecting;
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
  /// the connection down so the next connect attempt starts fresh rather
  /// than replaying a cached failure forever (the second Flutter-review
  /// CRITICAL finding: a `connection_error` that only completed the
  /// completer, without also clearing `_channel`/`_connectionAck`, left
  /// every later attempt permanently seeing a "connection" that was already
  /// dead).
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
          _isConnected = true;
          _connectionState.value = ConnectionState.connected;
          // Any successful connect — the very first one, or a reconnect
          // after backoff — clears pending retry state. A `subscribe()` call
          // racing ahead of a still-pending backoff timer (its own
          // `_ensureConnected` reuses the shared `_connectionAck` if one is
          // already in flight, or starts a fresh attempt otherwise) must not
          // leave a stale timer armed to fire again later against a
          // connection that is now healthy.
          _reconnectTimer?.cancel();
          _reconnectTimer = null;
          _reconnectPolicy.reset();
          _connectionAck?.complete();
        case 'connection_error':
          // Mapped as an auth failure, not a generic transport error: this
          // client's `connection_init` carries nothing but the AppSync auth
          // header (§14.2.2's own reasoning), so a server-side rejection of
          // it realistically means a bad or expired credential. That is
          // what lets the reconnect ladder (§14.3 S3) recognise this outcome
          // as terminal without any message-string matching — see
          // [_attemptReconnect].
          _failConnection(
            const UnauthorizedError(
              'Could not connect to the live-updates server.',
            ),
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
    if (id == null) {
      return;
    }
    final _SubscriptionRegistration? registration = _subscriptions[id];
    if (registration == null) {
      return;
    }
    _acknowledgedSubscriptionIds.add(id);
    if (_pendingRefetchAcks.remove(id)) {
      // This id's `start` was re-issued by a reconnect's own resubscribe,
      // not a subscription's first-ever registration — a push may have been
      // missed during the gap, so the caller must refetch (§14.2.4). A
      // synthetic event carrying no data of its own; the caller's own
      // refetch is what actually supplies fresh state, the same as every
      // other push already routes through `_forwardData`.
      registration.controller.add(
        const Response(data: null, response: <String, dynamic>{}),
      );
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
    unawaited(_subscriptions.remove(id)?.controller.close());
  }

  StreamController<Response>? _controllerFor(Map<String, Object?> message) =>
      _subscriptions[message['id'] as String?]?.controller;

  /// A channel-level error (not an AppSync protocol `error` frame — an
  /// actual socket failure) tears the transport down. Unlike W5/W8-S2,
  /// subscriber controllers are **not** closed here (§14.2.2's inverted
  /// close contract) — an established connection dying is now a transient
  /// event the reconnect ladder handles; only
  /// [_closeAllSubscriptionsWithTerminalError] (an unrecoverable auth
  /// failure) or the caller's own cancellation ever closes a subscriber's
  /// stream.
  Future<void> _handleChannelError(Object error) async {
    // A real abnormal closure can fire `onError` and `onDone` for the same
    // underlying event, and the keep-alive watchdog's own synthetic error
    // can race either — re-entering an already-in-flight teardown here would
    // re-run this same cleanup twice.
    if (_isTearingDown) {
      return;
    }
    _isTearingDown = true;
    final bool wasEstablished = _isConnected;
    final Completer<void>? ack = _connectionAck;
    if (ack != null && !ack.isCompleted) {
      // Never propagate the raw transport [error] to a still-pending
      // connect's own caller: `appSyncConnectUri` embeds the (reversibly
      // base64'd, not encrypted) id token in the socket's own connect URI,
      // and platform `WebSocketException`s commonly include that failed URI
      // verbatim in their message text — a first-connect failure otherwise
      // reaches `subscribe()`'s own caller via this completer unmodified,
      // risking a token leak into any future error-reporting/telemetry that
      // logs a subscription stream's error (security-reviewer HIGH finding).
      // An established connection dying never reaches a subscriber at all
      // any more (§14.2.2's inverted close contract), so this sanitization
      // only ever matters for the still-pending-first-connect case.
      ack.completeError(
        const InternalError('Could not connect to the live-updates server.'),
      );
    }
    await _closeChannelAndResetState();
    if (wasEstablished && _subscriptions.isNotEmpty) {
      _scheduleReconnect();
    }
  }

  Future<void> _handleChannelDone() async {
    // See the identical guard, and why it's needed, in [_handleChannelError].
    if (_isTearingDown) {
      return;
    }
    _isTearingDown = true;
    final bool wasEstablished = _isConnected;
    await _closeChannelAndResetState();
    if (wasEstablished && _subscriptions.isNotEmpty) {
      _scheduleReconnect();
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

  /// Shared by every teardown path ([_handleChannelError],
  /// [_handleChannelDone], [_disconnect]) — each previously repeated this
  /// same try/on/finally verbatim (code-reviewer MEDIUM finding); now a
  /// single copy to keep in sync. [_closeChannel] reaches real I/O
  /// (`sink.close()`) that this codebase's own fake test double cannot model
  /// throwing, but a real, already-broken `web_socket_channel` sink can. A
  /// close failure is swallowed as best-effort — there's nothing further to
  /// *do* about it, and nothing awaits this call's own return for it to
  /// usefully propagate to — but [_resetConnectionState] in `finally` must
  /// still run regardless: without it, a throw here would leave
  /// `_isTearingDown` stuck `true` forever, turning every later teardown
  /// call into a silent no-op and permanently preventing the client from
  /// ever reconnecting.
  Future<void> _closeChannelAndResetState() async {
    try {
      await _closeChannel();
    } on Object {
      // Best-effort — see this method's own doc.
    } finally {
      _resetConnectionState();
    }
  }

  /// Resets per-connection-episode bookkeeping. Deliberately does **not**
  /// clear [_subscriptions] (W8 S3, §14.2.2's inverted close contract) — a
  /// transient teardown must leave registered subscriptions in place so a
  /// scheduled reconnect can resubscribe them; only
  /// [_closeAllSubscriptionsWithTerminalError] (a terminal outcome) or a
  /// caller's own cancellation ever removes an entry. Also deliberately does
  /// not touch [_reconnectTimer]/[_reconnectPolicy] — those are owned by the
  /// reconnect-scheduling logic, not by per-connection teardown.
  void _resetConnectionState() {
    _channel = null;
    _connectionAck = null;
    _connectTimeoutTimer?.cancel();
    _connectTimeoutTimer = null;
    _channelSubscription = null;
    _keepAliveWatchdog?.cancel();
    _keepAliveWatchdog = null;
    _keepAliveTimeout = _defaultKeepAliveTimeout;
    _acknowledgedSubscriptionIds.clear();
    _pendingRefetchAcks.clear();
    _isConnected = false;
    _isTearingDown = false;
    _connectionState.value = ConnectionState.disconnected;
  }

  Future<void> _disconnect() async {
    // An explicit disconnect must win over a reconnect already scheduled
    // from an earlier transient failure — otherwise a caller who
    // deliberately disconnects (S4's future app-backgrounding call site)
    // could still see the client silently reconnect moments later from a
    // timer armed before this call (flutter-reviewer MEDIUM finding).
    // Unconditional, ahead of the teardown guard below: a pending timer can
    // exist independently of whether a teardown is currently in flight.
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    // See the identical guard, and why it's needed, in [_handleChannelError]
    // — a caller of the public [disconnect] can race an already-in-flight
    // teardown the same way `onError`/`onDone` can race each other.
    if (_isTearingDown) {
      return;
    }
    _isTearingDown = true;
    // A connection attempt can be genuinely in flight when this is called —
    // a fresh `subscribe()`'s own `onListen`, or an in-flight ladder
    // `_attemptReconnect()`, both `await _ensureConnected(...)`'s shared
    // completer. Failing it here, before tearing the transport down, is
    // what lets that awaiter resolve at all instead of hanging forever
    // (flutter-review HIGH finding) — `_resetConnectionState()` below would
    // otherwise null `_connectionAck` out from under it, uncompleted.
    final Completer<void>? ack = _connectionAck;
    if (ack != null && !ack.isCompleted) {
      ack.completeError(const _ConnectAbortedByDisconnect());
    }
    await _closeChannelAndResetState();
  }

  /// Arms the next reconnect attempt after [ReconnectPolicy]'s own delay —
  /// called only when an *established* connection died with at least one
  /// subscriber still registered (see [_handleChannelError]/
  /// [_handleChannelDone]).
  void _scheduleReconnect() {
    _connectionState.value = ConnectionState.disconnected;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(_reconnectPolicy.nextDelay(), () {
      unawaited(_attemptReconnect());
    });
  }

  /// Fetches a fresh token, reconnects, and resubscribes every still-
  /// registered id — or, on failure, either schedules the next rung of the
  /// backoff ladder (a transient failure) or closes every subscriber with
  /// [UnauthorizedError] (an unrecoverable one).
  Future<void> _attemptReconnect() async {
    _reconnectTimer = null;
    if (_subscriptions.isEmpty) {
      // Every subscriber cancelled during the backoff wait — nothing left to
      // reconnect for. A pending retry must not resurrect a connection
      // nobody wants anymore (§14.3 S3's own cancellation-during-backoff
      // case).
      return;
    }
    // Snapshotted *before* the token-fetch await below, which is a real
    // suspension point (the real `IdTokenProvider` can take genuine
    // wall-clock time). A brand-new `subscribe()` call racing ahead during
    // that gap registers itself in `_subscriptions` and sends its own first
    // `start` frame directly — it must not also be swept into
    // `_resubscribeAll` as if it were a survivor of the dead connection, or
    // it would receive a duplicate `start` frame and a spurious refetch
    // signal on what is actually its very first-ever `start_ack`
    // (flutter-reviewer HIGH finding).
    final Set<String> idsToResubscribe = _subscriptions.keys.toSet();
    _connectionState.value = ConnectionState.connecting;
    final String? idToken = await _fetchIdTokenForReconnect();
    if (idToken == null || idToken.isEmpty) {
      _closeAllSubscriptionsWithTerminalError(
        const UnauthorizedError(
          'You are signed out. Sign in again to continue.',
        ),
      );
      return;
    }
    try {
      await _ensureConnected(idToken);
    } on _ConnectAbortedByDisconnect {
      // An explicit disconnect() aborted this very attempt mid-flight (e.g.
      // the app backgrounded before this attempt's own handshake finished)
      // — that call already cancelled any pending reconnect timer, and the
      // ladder must not itself resurrect one right after (§14.3 S4: it does
      // not run while deliberately disconnected).
      return;
    } on UnauthorizedError catch (error) {
      // A freshly-fetched token was rejected — retrying with the same
      // provider would just fail the same way forever (§14.3 S3).
      _closeAllSubscriptionsWithTerminalError(error);
      return;
    } on Object {
      // Any other failure (a connect timeout, a still-unreachable network)
      // is transient — try again after the next backoff delay.
      _scheduleReconnect();
      return;
    }
    _resubscribeAll(idToken, idsToResubscribe);
  }

  Future<String?> _fetchIdTokenForReconnect() async {
    try {
      return await _idTokenProvider();
    } on Object {
      return null;
    }
  }

  /// Re-issues a `start` frame for every subscription that both survived the
  /// dead connection ([idsToResubscribe], snapshotted before this reconnect
  /// attempt's own token fetch) and is still registered now, using its own
  /// originally-registered query/variables and the just-fetched token
  /// (never a token cached from the original `subscribe()` call — §14.3
  /// S3's "fresh token on every attempt"). Marks each such id pending a
  /// refetch signal, delivered once its `start_ack` actually lands (see
  /// [_handleStartAck]). A brand-new subscription registered *during* this
  /// reconnect attempt (not in [idsToResubscribe]) already sent its own
  /// first `start` frame directly from `subscribe()`'s own `onListen` and
  /// must not be re-sent here nor marked pending a refetch — it has no prior
  /// connection to have missed anything from.
  void _resubscribeAll(String idToken, Set<String> idsToResubscribe) {
    final String host = appSyncApiHost(httpGraphQlUrl);
    for (final MapEntry<String, _SubscriptionRegistration> entry
        in _subscriptions.entries) {
      if (!idsToResubscribe.contains(entry.key)) {
        continue;
      }
      _pendingRefetchAcks.add(entry.key);
      _channel!.sink.add(
        jsonEncode(
          startFrame(
            id: entry.key,
            query: entry.value.query,
            variables: entry.value.variables,
            idToken: idToken,
            host: host,
          ),
        ),
      );
    }
  }

  /// Terminal outcome: closes every subscriber with [error] and abandons the
  /// reconnect ladder entirely — used only for an unrecoverable auth
  /// failure (a null token, or a `connection_error` against a
  /// freshly-fetched one), where retrying would loop against a credential
  /// that will never become valid on its own (§14.3 S3).
  void _closeAllSubscriptionsWithTerminalError(Object error) {
    for (final _SubscriptionRegistration registration
        in _subscriptions.values) {
      registration.controller.addError(error);
      unawaited(registration.controller.close());
    }
    _subscriptions.clear();
    _pendingRefetchAcks.clear();
    _reconnectPolicy.reset();
    _connectionState.value = ConnectionState.disconnected;
  }
}

/// Thrown internally to fail a still-pending [Completer] the moment an
/// explicit [AppSyncSubscriptionClient.disconnect] call aborts an in-flight
/// connection attempt (W8 S4) — never left silently hanging (flutter-review
/// HIGH finding: without this, a `disconnect()` racing a still-connecting
/// `_ensureConnected` used to null out `_connectionAck` without ever
/// completing it, leaving that awaiter — a fresh `subscribe()`'s own
/// `onListen`, or an in-flight ladder `_attemptReconnect()` — suspended
/// forever). A distinct type, not a generic [InternalError], specifically so
/// [_attemptReconnect] can tell "deliberately disconnected mid-attempt"
/// (must not reschedule — the ladder does not run while backgrounded) apart
/// from a genuine transient failure like a connect timeout (must
/// reschedule) without relying on any shared, timing-sensitive flag.
/// [subscribe]'s own `onListen` catch maps this to a public [InternalError]
/// before it ever reaches a subscriber — this type itself is never surfaced.
class _ConnectAbortedByDisconnect implements Exception {
  const _ConnectAbortedByDisconnect();
}

/// One caller's registration on the shared connection — enough to re-issue
/// its `start` frame verbatim on a reconnect (W8 S3), which a bare
/// `StreamController` alone can't do since the query/variables it was
/// opened with are otherwise discarded after the initial `start` send.
class _SubscriptionRegistration {
  _SubscriptionRegistration({
    required this.controller,
    required this.query,
    required this.variables,
  });

  final StreamController<Response> controller;
  final String query;
  final Map<String, Object?> variables;
}
