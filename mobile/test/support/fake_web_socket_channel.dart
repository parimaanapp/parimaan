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
    _channel.closed = true;
  }

  @override
  Future<dynamic> get done => Future<void>.value();
}
