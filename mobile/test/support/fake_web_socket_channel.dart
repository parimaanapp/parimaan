import 'dart:async';
import 'dart:convert';

import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// A [WebSocketChannel] double for [AppSyncSubscriptionClient] tests — no
/// real socket, no real network. [emit] plays a server frame; [sentFrames]
/// asserts what the client under test sent.
class FakeWebSocketChannel with StreamChannelMixin<Object?> implements WebSocketChannel {
  FakeWebSocketChannel();

  final StreamController<Object?> _incoming = StreamController<Object?>.broadcast();
  final List<Map<String, Object?>> sentFrames = <Map<String, Object?>>[];
  bool closed = false;

  /// How many times `sink.close()` has been invoked — a redundant second
  /// teardown calling this again is exactly the failure shape an
  /// `_isTearingDown`-style guard exists to prevent, so a test can assert
  /// this stays at 1 rather than only checking [closed] (which a second
  /// close call would leave unchanged, silently hiding the redundancy).
  int closeCallCount = 0;

  /// When set, `sink.close()` suspends on this future before marking
  /// [closed] — lets a test hold one teardown's own close call open long
  /// enough to deterministically race a second, independent trigger against
  /// it, rather than hoping real timing happens to overlap.
  Future<void>? closeGate;

  /// When set, `sink.close()` throws this instead of completing — the shape
  /// a real, already-broken `web_socket_channel` sink can produce, which
  /// this fake otherwise cannot model. Lets a test prove teardown state
  /// (e.g. `AppSyncSubscriptionClient`'s own `_isTearingDown`) is still
  /// cleaned up even when closing the real transport itself fails.
  Object? closeError;

  @override
  Stream<Object?> get stream => _incoming.stream;

  @override
  WebSocketSink get sink => _FakeWebSocketSink(this);

  /// Plays one AppSync realtime protocol frame from the "server" side.
  void emit(Map<String, Object?> frame) => _incoming.add(jsonEncode(frame));

  /// Plays a raw, non-JSON-encoded string — for asserting the client under
  /// test survives a malformed frame rather than crashing its listener.
  void emitRaw(String raw) => _incoming.add(raw);

  void emitError(Object error) => _incoming.addError(error);

  Future<void> emitDone() => _incoming.close();

  @override
  String? get protocol => null;

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;

  @override
  Future<void> get ready => Future<void>.value();
}

class _FakeWebSocketSink implements WebSocketSink {
  _FakeWebSocketSink(this._channel);

  final FakeWebSocketChannel _channel;

  @override
  void add(dynamic event) {
    _channel.sentFrames.add(jsonDecode(event as String) as Map<String, Object?>);
  }

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future<void> addStream(Stream<dynamic> stream) async {}

  @override
  Future<dynamic> close([int? closeCode, String? closeReason]) async {
    _channel.closeCallCount++;
    final Future<void>? gate = _channel.closeGate;
    if (gate != null) {
      await gate;
    }
    final Object? error = _channel.closeError;
    if (error != null) {
      throw error;
    }
    _channel.closed = true;
  }

  @override
  Future<dynamic> get done => Future<void>.value();
}
