import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/graphql/subscription_client.dart';

import '../../support/fake_web_socket_channel.dart';

const String _httpUrl = 'https://abc.appsync-api.ap-south-1.amazonaws.com/graphql';
const String _query =
    'subscription OnPantryChanged(\$householdId: ID!) { onPantryChanged(householdId: \$householdId) { id } }';

void main() {
  group('AppSyncSubscriptionClient', () {
    test('sends connection_init then a start frame carrying the query/variables/token', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final Stream<Response> stream = client.subscribe(
        query: _query,
        variables: <String, Object?>{'householdId': 'household-1'},
        idToken: 'token-123',
      );
      final StreamSubscription<Response> sub = stream.listen((_) {});
      addTearDown(sub.cancel);

      await pumpEventQueue();

      expect(channel.sentFrames, hasLength(1));
      expect(channel.sentFrames.first['type'], 'connection_init');

      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      expect(channel.sentFrames, hasLength(2));
      final Map<String, Object?> startFrame = channel.sentFrames[1];
      expect(startFrame['type'], 'start');
      expect(startFrame['id'], isNotNull);
    });

    test('forwards a data frame as a Response with matching data', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Response> received = <Response>[];
      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'household-1'},
            idToken: 'token-123',
          )
          .listen(received.add);
      addTearDown(sub.cancel);

      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();
      final String id = channel.sentFrames.last['id']! as String;

      channel.emit(<String, Object?>{
        'type': 'data',
        'id': id,
        'payload': <String, Object?>{
          'data': <String, Object?>{
            'onPantryChanged': <String, Object?>{'id': 'item-1', 'name': 'Toor Dal'},
          },
        },
      });
      await pumpEventQueue();

      expect(received, hasLength(1));
      expect(received.single.data, <String, Object?>{
        'onPantryChanged': <String, Object?>{'id': 'item-1', 'name': 'Toor Dal'},
      });
    });

    test('forwards an error frame as a Response carrying a mapped GraphQLError', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Response> received = <Response>[];
      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'household-1'},
            idToken: 'token-123',
          )
          .listen(received.add);
      addTearDown(sub.cancel);

      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();
      final String id = channel.sentFrames.last['id']! as String;

      channel.emit(<String, Object?>{
        'type': 'error',
        'id': id,
        'payload': <String, Object?>{
          'errors': <Object?>[
            <String, Object?>{
              'message': 'You are not a member of this household.',
              'errorType': 'FORBIDDEN',
            },
          ],
        },
      });
      await pumpEventQueue();

      expect(received, hasLength(1));
      expect(received.single.errors, hasLength(1));
      expect(received.single.errors!.single.message, 'You are not a member of this household.');
      expect(received.single.errors!.single.extensions?['errorType'], 'FORBIDDEN');
    });

    test('a second concurrent subscribe reuses the same connection — only one connection_init', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> subA = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
          .listen((_) {});
      addTearDown(subA.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      final StreamSubscription<Response> subB = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'b'}, idToken: 't')
          .listen((_) {});
      addTearDown(subB.cancel);
      await pumpEventQueue();

      final int initCount = channel.sentFrames.where((Map<String, Object?> f) => f['type'] == 'connection_init').length;
      expect(initCount, 1);
      final int startCount = channel.sentFrames.where((Map<String, Object?> f) => f['type'] == 'start').length;
      expect(startCount, 2);
    });

    test('cancelling the only subscriber sends stop and closes the socket', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> sub = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
          .listen((_) {});
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      await sub.cancel();
      await pumpEventQueue();

      expect(channel.sentFrames.last['type'], 'stop');
      expect(channel.closed, isTrue);
    });

    test('connection_error surfaces as an InternalError to the pending subscribe', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> errors = <Object>[];
      final StreamSubscription<Response> sub = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
          .listen((_) {}, onError: errors.add);
      addTearDown(sub.cancel);

      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_error'});
      await pumpEventQueue();

      expect(errors, hasLength(1));
      expect(errors.single, isA<InternalError>());
    });

    test(
      'a connection_error does not permanently poison the client — a later subscribe reconnects fresh',
      () async {
        final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          channelFactory: (Uri uri, {Iterable<String>? protocols}) {
            final FakeWebSocketChannel channel = FakeWebSocketChannel();
            channels.add(channel);
            return channel;
          },
        );

        final List<Object> firstErrors = <Object>[];
        final StreamSubscription<Response> first = client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
            .listen((_) {}, onError: firstErrors.add);
        await pumpEventQueue();
        channels.single.emit(const <String, Object?>{'type': 'connection_error'});
        await pumpEventQueue();
        expect(firstErrors, hasLength(1));
        await first.cancel();

        final List<Response> secondEvents = <Response>[];
        final StreamSubscription<Response> second = client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'b'}, idToken: 't')
            .listen(secondEvents.add);
        addTearDown(second.cancel);
        await pumpEventQueue();

        // A brand new channel — proof the client didn't just replay the
        // stale failed completer from the first attempt.
        expect(channels, hasLength(2));
        expect(
          channels.last.sentFrames.where((Map<String, Object?> f) => f['type'] == 'connection_init'),
          hasLength(1),
        );
      },
    );

    test('two concurrent subscribes both fail when the shared connect attempt times out', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errorsA = <Object>[];
        final List<Object> errorsB = <Object>[];
        client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
            .listen((_) {}, onError: errorsA.add);
        async.flushMicrotasks();
        client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'b'}, idToken: 't')
            .listen((_) {}, onError: errorsB.add);
        async.flushMicrotasks();

        async.elapse(const Duration(seconds: 11));

        expect(errorsA, hasLength(1));
        expect(errorsB, hasLength(1));
        expect(errorsA.single, isA<InternalError>());
        expect(errorsB.single, isA<InternalError>());
      });
    });

    test('cancelling while still connecting does not register or crash — no start frame is sent', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> errors = <Object>[];
      final StreamSubscription<Response> sub = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
          .listen((_) {}, onError: errors.add);
      // Cancel before the connect (which needs `connection_ack`) ever settles.
      await sub.cancel();
      await pumpEventQueue();

      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      expect(errors, isEmpty);
      expect(channel.sentFrames.where((Map<String, Object?> f) => f['type'] == 'start'), isEmpty);
    });

    test('a malformed (non-JSON) frame is dropped, not thrown from the stream listener', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Response> received = <Response>[];
      final List<Object> errors = <Object>[];
      final StreamSubscription<Response> sub = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
          .listen(received.add, onError: errors.add);
      addTearDown(sub.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();
      final String id = channel.sentFrames.last['id']! as String;

      // Not `emit` — that always encodes valid JSON. `emitRaw` bypasses it
      // to push a raw, unparseable string, the shape `_handleRawMessage`
      // must survive without crashing the listener.
      channel.emitRaw('not json');
      await pumpEventQueue();

      channel.emit(<String, Object?>{
        'type': 'data',
        'id': id,
        'payload': <String, Object?>{
          'data': <String, Object?>{'onPantryChanged': <String, Object?>{'id': 'item-1'}},
        },
      });
      await pumpEventQueue();

      expect(errors, isEmpty);
      expect(received, hasLength(1));
    });

    test('a channel-level error closes every active subscriber and resets connection state', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> errors = <Object>[];
      bool done = false;
      final StreamSubscription<Response> sub = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
          .listen((_) {}, onError: errors.add, onDone: () => done = true);
      addTearDown(sub.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      channel.emitError(StateError('socket reset'));
      await pumpEventQueue();

      expect(errors, hasLength(1));
      expect(done, isTrue);
    });
  });
}
