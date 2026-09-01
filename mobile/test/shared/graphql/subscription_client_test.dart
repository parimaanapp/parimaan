import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/graphql/subscription_client.dart';

import '../../support/fake_web_socket_channel.dart';

const String _httpUrl =
    'https://abc.appsync-api.ap-south-1.amazonaws.com/graphql';
const String _query =
    'subscription OnPantryChanged(\$householdId: ID!) { onPantryChanged(householdId: \$householdId) { id } }';

void main() {
  group('AppSyncSubscriptionClient', () {
    test('sends connection_init then a start frame carrying the query/variables/token', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
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
        idTokenProvider: () async => 'fresh-token',
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
            'onPantryChanged': <String, Object?>{
              'id': 'item-1',
              'name': 'Toor Dal',
            },
          },
        },
      });
      await pumpEventQueue();

      expect(received, hasLength(1));
      expect(received.single.data, <String, Object?>{
        'onPantryChanged': <String, Object?>{
          'id': 'item-1',
          'name': 'Toor Dal',
        },
      });
    });

    test(
      'forwards an error frame as a Response carrying a mapped GraphQLError',
      () async {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
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
        expect(
          received.single.errors!.single.message,
          'You are not a member of this household.',
        );
        expect(
          received.single.errors!.single.extensions?['errorType'],
          'FORBIDDEN',
        );
      },
    );

    test('a second concurrent subscribe reuses the same connection — only one connection_init', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> subA = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {});
      addTearDown(subA.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      final StreamSubscription<Response> subB = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'b'},
            idToken: 't',
          )
          .listen((_) {});
      addTearDown(subB.cancel);
      await pumpEventQueue();

      final int initCount = channel.sentFrames
          .where((Map<String, Object?> f) => f['type'] == 'connection_init')
          .length;
      expect(initCount, 1);
      final int startCount = channel.sentFrames
          .where((Map<String, Object?> f) => f['type'] == 'start')
          .length;
      expect(startCount, 2);
    });

    test(
      'cancelling the only subscriber sends stop and closes the socket',
      () async {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final StreamSubscription<Response> sub = client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {});
        await pumpEventQueue();
        channel.emit(const <String, Object?>{'type': 'connection_ack'});
        await pumpEventQueue();

        await sub.cancel();
        await pumpEventQueue();

        expect(channel.sentFrames.last['type'], 'stop');
        expect(channel.closed, isTrue);
      },
    );

    test('connection_error surfaces as an UnauthorizedError to the pending subscribe', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> errors = <Object>[];
      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: errors.add);
      addTearDown(sub.cancel);

      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_error'});
      await pumpEventQueue();

      // Mapped as an auth failure, not a generic transport error (W8 S3,
      // §14.2.2): `connection_init` carries nothing but the auth header, so
      // a server-side rejection of it realistically means a bad/expired
      // credential — this is what lets the reconnect ladder recognise a
      // `connection_error` against a freshly-fetched token as terminal.
      expect(errors, hasLength(1));
      expect(errors.single, isA<UnauthorizedError>());
    });

    test('a connection_error does not permanently poison the client — a later subscribe reconnects fresh', () async {
      final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) {
          final FakeWebSocketChannel channel = FakeWebSocketChannel();
          channels.add(channel);
          return channel;
        },
      );

      final List<Object> firstErrors = <Object>[];
      final StreamSubscription<Response> first = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: firstErrors.add);
      await pumpEventQueue();
      channels.single.emit(const <String, Object?>{'type': 'connection_error'});
      await pumpEventQueue();
      expect(firstErrors, hasLength(1));
      await first.cancel();

      final List<Response> secondEvents = <Response>[];
      final StreamSubscription<Response> second = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'b'},
            idToken: 't',
          )
          .listen(secondEvents.add);
      addTearDown(second.cancel);
      await pumpEventQueue();

      // A brand new channel — proof the client didn't just replay the
      // stale failed completer from the first attempt.
      expect(channels, hasLength(2));
      expect(
        channels.last.sentFrames.where(
          (Map<String, Object?> f) => f['type'] == 'connection_init',
        ),
        hasLength(1),
      );
    });

    test('two concurrent subscribes both fail when the shared connect attempt times out', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errorsA = <Object>[];
        final List<Object> errorsB = <Object>[];
        client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {}, onError: errorsA.add);
        async.flushMicrotasks();
        client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'b'},
              idToken: 't',
            )
            .listen((_) {}, onError: errorsB.add);
        async.flushMicrotasks();

        async.elapse(const Duration(seconds: 11));

        expect(errorsA, hasLength(1));
        expect(errorsB, hasLength(1));
        expect(errorsA.single, isA<InternalError>());
        expect(errorsB.single, isA<InternalError>());
      });
    });

    test('a real transport error during a still-pending first connect never leaks its own message (which may embed the token-bearing connect URI) to the caller', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> errors = <Object>[];
      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: errors.add);
      addTearDown(sub.cancel);
      await pumpEventQueue();

      // A raw platform exception, the kind a real `WebSocketException`
      // commonly carries — including the failed connect URI, which itself
      // embeds the id token in its `header` query parameter
      // (`appSyncConnectUri`). This must never reach the caller verbatim
      // (security-reviewer HIGH finding).
      channel.emitError(
        Exception(
          'Connection to wss://abc/graphql?header=eyJob3N0IjoiYWJjIiwiQXV0aG9yaXphdGlvbiI6InNlY3JldC10b2tlbiJ9 failed',
        ),
      );
      await pumpEventQueue();

      expect(errors, hasLength(1));
      expect(errors.single, isA<InternalError>());
      expect(
        (errors.single as InternalError).toString(),
        isNot(contains('secret-token')),
        reason: 'the sanitized error must not carry the raw transport exception text',
      );
    });

    test('cancelling while still connecting does not register or crash — no start frame is sent', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> errors = <Object>[];
      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: errors.add);
      // Cancel before the connect (which needs `connection_ack`) ever settles.
      await sub.cancel();
      await pumpEventQueue();

      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      expect(errors, isEmpty);
      expect(
        channel.sentFrames.where(
          (Map<String, Object?> f) => f['type'] == 'start',
        ),
        isEmpty,
      );
    });

    test('a malformed (non-JSON) frame is dropped, not thrown from the stream listener', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Response> received = <Response>[];
      final List<Object> errors = <Object>[];
      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
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
          'data': <String, Object?>{
            'onPantryChanged': <String, Object?>{'id': 'item-1'},
          },
        },
      });
      await pumpEventQueue();

      expect(errors, isEmpty);
      expect(received, hasLength(1));
    });

    test('a channel-level error on an established connection leaves the subscriber stream open — it is not closed', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> errors = <Object>[];
      bool done = false;
      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: errors.add, onDone: () => done = true);
      addTearDown(sub.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      channel.emitError(StateError('socket reset'));
      await pumpEventQueue();

      // W8 S3's inverted close contract (§14.2.2): an established
      // connection dying is now a transient event the reconnect ladder
      // handles, not something that closes the caller's own stream — the
      // opposite of W5/S2's original behaviour.
      expect(errors, isEmpty);
      expect(done, isFalse);
      // The transport itself is still torn down, even though the
      // subscriber survives.
      expect(channel.closed, isTrue);
    });

    group('reconnect (W8 S3)', () {
      test('an established connection dying reconnects with a fresh token, resubscribes the same id, '
          'and emits exactly one refetch signal once the resubscribe is acknowledged', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          int tokenFetchCount = 0;
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async {
              tokenFetchCount++;
              return 'reconnect-token-$tokenFetchCount';
            },
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          final List<Response> received = <Response>[];
          final List<Object> errors = <Object>[];
          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 'original-token',
              )
              .listen(received.add, onError: errors.add);
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();
          final String id = channels.single.sentFrames.last['id']! as String;
          channels.single.emit(<String, Object?>{
            'type': 'start_ack',
            'id': id,
          });
          async.flushMicrotasks();
          expect(
            tokenFetchCount,
            0,
            reason: 'the original subscribe token came from the caller, not the provider',
          );

          // The transport dies.
          channels.single.emitError(StateError('socket reset'));
          async.flushMicrotasks();
          expect(
            received,
            isEmpty,
            reason: 'no refetch yet — the reconnect has not happened',
          );
          expect(errors, isEmpty);

          // Advance past the ladder's first, jittered ~1s rung.
          async.elapse(const Duration(milliseconds: 1300));
          async.flushMicrotasks();

          expect(
            channels,
            hasLength(2),
            reason: 'a brand new connect attempt was made',
          );
          expect(
            tokenFetchCount,
            1,
            reason: 'the reconnect fetched a fresh token, not the original one',
          );

          channels.last.emit(const <String, Object?>{'type': 'connection_ack'});
          async.flushMicrotasks();

          final Map<String, Object?> resentStart = channels.last.sentFrames
              .firstWhere((Map<String, Object?> f) => f['type'] == 'start');
          expect(
            resentStart['id'],
            id,
            reason: 'the same subscription id is resubscribed, not a new one',
          );
          final Map<String, Object?> auth =
              (resentStart['payload']! as Map<String, Object?>)['extensions']!
                  as Map<String, Object?>;
          expect(
            (auth['authorization']! as Map<String, Object?>)['Authorization'],
            'reconnect-token-1',
            reason: 'the resubscribe carries the freshly-fetched token, not the original subscribe token',
          );
          expect(
            received,
            isEmpty,
            reason: 'no refetch until the resubscribe is actually acknowledged',
          );

          channels.last.emit(<String, Object?>{'type': 'start_ack', 'id': id});
          async.flushMicrotasks();

          expect(
            received,
            hasLength(1),
            reason: 'exactly one synthetic refetch signal after the reconnect',
          );
        });
      });

      test('a null token from the provider on reconnect closes every subscriber with UnauthorizedError', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async => null,
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          final List<Object> errors = <Object>[];
          bool done = false;
          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: errors.add, onDone: () => done = true);
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          channels.single.emitError(StateError('socket reset'));
          async.flushMicrotasks();
          expect(
            errors,
            isEmpty,
            reason:
                'still transient at this point — the ladder has not run yet',
          );

          async.elapse(const Duration(milliseconds: 1300));
          async.flushMicrotasks();

          expect(
            channels,
            hasLength(1),
            reason: 'a null token never reaches _ensureConnected — no new connect attempt',
          );
          expect(errors, hasLength(1));
          expect(errors.single, isA<UnauthorizedError>());
          expect(done, isTrue);
        });
      });

      test('a connection_error against a freshly-fetched reconnect token closes every subscriber and stops the ladder', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async => 'still-bad-token',
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          final List<Object> errors = <Object>[];
          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: errors.add);
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          channels.single.emitError(StateError('socket reset'));
          async.flushMicrotasks();
          async.elapse(const Duration(milliseconds: 1300));
          async.flushMicrotasks();
          expect(channels, hasLength(2));

          // The reconnect attempt's own connect is rejected too.
          channels.last.emit(const <String, Object?>{
            'type': 'connection_error',
          });
          async.flushMicrotasks();

          expect(errors, hasLength(1));
          expect(errors.single, isA<UnauthorizedError>());

          // No further reconnect attempt — the ladder stopped rather than
          // retrying forever against a token that will never become valid.
          async.elapse(const Duration(seconds: 90));
          expect(channels, hasLength(2));
        });
      });

      test('cancelling the only subscriber during the backoff wait prevents the pending retry from resurrecting the connection', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          int tokenFetchCount = 0;
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async {
              tokenFetchCount++;
              return 'reconnect-token';
            },
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          final StreamSubscription<Response> sub = client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          channels.single.emitError(StateError('socket reset'));
          async.flushMicrotasks();

          // The caller cancels while still mid-backoff, before the pending
          // reconnect timer has fired.
          unawaited(sub.cancel());
          async.flushMicrotasks();

          async.elapse(const Duration(seconds: 90));

          expect(
            channels,
            hasLength(1),
            reason: 'no reconnect attempt was made for a cancelled subscriber',
          );
          expect(tokenFetchCount, 0);
        });
      });

      test('the reconnect ladder does not run while explicitly disconnected via disconnect()', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          int tokenFetchCount = 0;
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async {
              tokenFetchCount++;
              return 'reconnect-token';
            },
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          // An explicit disconnect() call, not a channel death — S3's ladder
          // must not treat this the same as a transient failure worth
          // retrying (S4's future app-backgrounding call site relies on
          // this: backgrounding must not itself trigger a reconnect storm).
          unawaited(client.disconnect());
          async.flushMicrotasks();

          async.elapse(const Duration(seconds: 90));

          expect(
            channels,
            hasLength(1),
            reason: 'disconnect() must not arm the reconnect ladder',
          );
          expect(tokenFetchCount, 0);
        });
      });

      test('disconnect() called mid-backoff cancels the already-scheduled reconnect — it does not still fire later', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          int tokenFetchCount = 0;
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async {
              tokenFetchCount++;
              return 'reconnect-token';
            },
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          // The transport dies, arming a reconnect timer...
          channels.single.emitError(StateError('socket reset'));
          async.flushMicrotasks();

          // ...and then, before that timer fires, the caller explicitly
          // disconnects (still with a subscriber registered — unlike the
          // cancellation test above, this is `disconnect()`, not the last
          // subscriber leaving).
          unawaited(client.disconnect());
          async.flushMicrotasks();

          async.elapse(const Duration(seconds: 90));

          expect(
            channels,
            hasLength(1),
            reason: 'the reconnect timer armed before disconnect() must not still fire afterward',
          );
          expect(tokenFetchCount, 0);
        });
      });

      test('a fresh subscribe() racing a reconnect attempt is not swept into the resubscribe-all step', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          final Completer<String> reconnectTokenCompleter = Completer<String>();
          int tokenFetchCount = 0;
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () {
              tokenFetchCount++;
              // The first fetch (the reconnect's own) suspends until the
              // test explicitly completes it below — modelling a real
              // `IdTokenProvider` that takes genuine wall-clock time,
              // which is the window a fresh `subscribe()` can race into.
              return tokenFetchCount == 1
                  ? reconnectTokenCompleter.future
                  : Future<String>.value('later-token');
            },
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          final List<Response> firstReceived = <Response>[];
          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen(firstReceived.add, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();
          final String firstId =
              channels.single.sentFrames.last['id']! as String;
          channels.single.emit(<String, Object?>{
            'type': 'start_ack',
            'id': firstId,
          });
          async.flushMicrotasks();

          // The transport dies, and the ladder's first rung elapses,
          // starting a reconnect attempt whose own token fetch is now
          // suspended on `reconnectTokenCompleter`.
          channels.single.emitError(StateError('socket reset'));
          async.flushMicrotasks();
          async.elapse(const Duration(milliseconds: 1300));
          async.flushMicrotasks();
          expect(
            tokenFetchCount,
            1,
            reason: 'the reconnect attempt has started fetching a fresh token',
          );

          // While that fetch is still pending, a caller opens a brand-new,
          // unrelated subscription — its own onListen races ahead and
          // registers/sends its own `start` frame directly, all before the
          // reconnect's own token fetch resolves.
          final List<Response> secondReceived = <Response>[];
          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'b'},
                idToken: 't',
              )
              .listen(secondReceived.add, onError: (Object _) {});
          async.flushMicrotasks();

          // Now let the reconnect's own token fetch resolve and the
          // reconnect actually complete.
          reconnectTokenCompleter.complete('reconnect-token');
          async.flushMicrotasks();
          expect(
            channels,
            hasLength(2),
            reason: 'the shared reconnect attempt opened one new connection',
          );
          channels.last.emit(const <String, Object?>{'type': 'connection_ack'});
          async.flushMicrotasks();

          // The brand-new subscription's id must appear exactly once in
          // the sent `start` frames on the new channel (its own original
          // send) — resubscribe-all must not have swept it up and sent a
          // second, duplicate `start` for it.
          final String secondId =
              channels.last.sentFrames.firstWhere(
                    (Map<String, Object?> f) => f['type'] == 'start',
                  )['id']!
                  as String;
          final int secondIdStartCount = channels.last.sentFrames
              .where(
                (Map<String, Object?> f) =>
                    f['type'] == 'start' && f['id'] == secondId,
              )
              .length;
          expect(
            secondIdStartCount,
            1,
            reason: 'no duplicate start frame for the newly-registered subscription',
          );

          // And its first-ever start_ack must not trigger a refetch —
          // there is nothing it could have missed.
          channels.last.emit(<String, Object?>{
            'type': 'start_ack',
            'id': secondId,
          });
          async.flushMicrotasks();
          expect(
            secondReceived,
            isEmpty,
            reason: "a brand-new subscription's very first start_ack must never emit a refetch signal",
          );

          // The original, genuinely-reconnected subscription still gets
          // its own resubscribe and refetch as normal.
          final int firstIdStartCountOnNewChannel = channels.last.sentFrames
              .where(
                (Map<String, Object?> f) =>
                    f['type'] == 'start' && f['id'] == firstId,
              )
              .length;
          expect(firstIdStartCountOnNewChannel, 1);
          channels.last.emit(<String, Object?>{
            'type': 'start_ack',
            'id': firstId,
          });
          async.flushMicrotasks();
          expect(
            firstReceived,
            hasLength(1),
            reason:
                'the genuinely-reconnected subscription still gets its refetch',
          );
        });
      });
    });

    group('reconnectNow (W8 S4)', () {
      test(
        'reconnectNow() with no registered subscriptions opens no connection',
        () {
          fakeAsync((FakeAsync async) {
            final List<FakeWebSocketChannel> channels =
                <FakeWebSocketChannel>[];
            int tokenFetchCount = 0;
            final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
              httpGraphQlUrl: _httpUrl,
              idTokenProvider: () async {
                tokenFetchCount++;
                return 'token';
              },
              channelFactory: (Uri uri, {Iterable<String>? protocols}) {
                final FakeWebSocketChannel channel = FakeWebSocketChannel();
                channels.add(channel);
                return channel;
              },
            );

            unawaited(client.reconnectNow());
            async.flushMicrotasks();

            expect(
              channels,
              isEmpty,
              reason: 'nothing to reconnect for — the foreground-with-no-subscriptions case',
            );
            expect(tokenFetchCount, 0);
          });
        },
      );

      test('after disconnect(), reconnectNow() reconnects immediately (no backoff wait) and resets the ladder to 1s', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async => 'reconnect-token',
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();
          final String id = channels.single.sentFrames.last['id']! as String;

          // The app-lifecycle observer's background path: an explicit
          // disconnect while a subscriber is still registered.
          unawaited(client.disconnect());
          async.flushMicrotasks();
          expect(
            channels,
            hasLength(1),
            reason:
                'disconnect() tears down the transport, not the registration',
          );

          // The foreground path: no waiting for any backoff timer at all.
          unawaited(client.reconnectNow());
          async.flushMicrotasks();
          expect(
            channels,
            hasLength(2),
            reason: 'reconnectNow() connects immediately — it does not arm and wait for a backoff Timer',
          );

          channels.last.emit(const <String, Object?>{'type': 'connection_ack'});
          async.flushMicrotasks();
          final Map<String, Object?> resentStart = channels.last.sentFrames
              .firstWhere((Map<String, Object?> f) => f['type'] == 'start');
          expect(resentStart['id'], id);

          // Now prove the ladder actually reset to 1s, not left wherever it
          // was: kill this new connection too and measure the next delay.
          channels.last.emitError(StateError('socket reset'));
          async.flushMicrotasks();
          expect(
            channels,
            hasLength(2),
            reason: 'no reconnect attempt yet — still waiting out the backoff delay',
          );
          async.elapse(const Duration(milliseconds: 700));
          expect(
            channels,
            hasLength(2),
            reason:
                'a delay below 1s (even with +20% jitter never exceeding it) proves the ladder did not '
                'resume mid-ladder — resetting via reconnectNow() means the very next failure waits ~1s again',
          );
          async.elapse(const Duration(milliseconds: 600));
          expect(
            channels,
            hasLength(3),
            reason: 'the reset 1s rung has now elapsed',
          );
        });
      });

      test('reconnectNow() while already connected is a no-op — it opens no second transport', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          int tokenFetchCount = 0;
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async {
              tokenFetchCount++;
              return 'token';
            },
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();
          final int startFrameCountBefore = channels.single.sentFrames
              .where((Map<String, Object?> f) => f['type'] == 'start')
              .length;

          unawaited(client.reconnectNow());
          async.flushMicrotasks();

          expect(
            channels,
            hasLength(1),
            reason: 'still connected — nothing needed reconnecting',
          );
          expect(
            tokenFetchCount,
            0,
            reason: 'a no-op reconnectNow() must not even fetch a token',
          );
          final int startFrameCountAfter = channels.single.sentFrames
              .where((Map<String, Object?> f) => f['type'] == 'start')
              .length;
          expect(
            startFrameCountAfter,
            startFrameCountBefore,
            reason: 'no redundant resubscribe for a subscription that never actually disconnected',
          );
        });
      });

      test('a rapid background/foreground pair — reconnectNow() called while disconnect() is still mid-close — '
          'still reconnects once settled, rather than silently swallowing the foreground signal', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          final Completer<void> closeGate = Completer<void>();
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async => 'token',
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              // Only the *first* channel's close is held open — modelling
              // "the background teardown's own sink.close() hasn't
              // resolved yet," the real-world gap that lets a foreground
              // event arrive before `_isConnected`/`_isTearingDown` have
              // settled back down.
              if (channels.isEmpty) {
                channel.closeGate = closeGate.future;
              }
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          // Background: disconnect() starts, but its own sink.close() is
          // held open by closeGate — this teardown has NOT finished yet.
          unawaited(client.disconnect());
          async.flushMicrotasks();

          // Foreground arrives immediately after, before the background
          // teardown above has actually settled.
          unawaited(client.reconnectNow());
          async.flushMicrotasks();
          expect(
            channels,
            hasLength(1),
            reason: 'reconnectNow() is queued behind the still-in-flight disconnect(), not raced against it',
          );

          // Now let the background teardown actually finish.
          closeGate.complete();
          async.flushMicrotasks();

          // The queued reconnectNow() must now run for real — the
          // foreground signal was not lost just because it arrived while
          // the background teardown was still settling.
          expect(
            channels,
            hasLength(2),
            reason: 'the foreground intent survives — a second, genuine connect attempt is made',
          );
          expect(channels.first.closed, isTrue);
          expect(channels.last.closed, isFalse);
        });
      });

      test('rapid disconnect()/reconnectNow()/disconnect() leaves exactly one live transport and no lingering timer', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async => 'token',
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          // background, foreground, background again, in rapid succession —
          // no time is allowed to pass between them.
          unawaited(client.disconnect());
          unawaited(client.reconnectNow());
          unawaited(client.disconnect());
          async.flushMicrotasks();

          expect(
            channels.where((FakeWebSocketChannel c) => !c.closed),
            hasLength(lessThanOrEqualTo(1)),
            reason: 'no two live sockets left open at once',
          );

          // No pending reconnect ladder either — advancing time must not
          // suddenly open a connection nobody asked for.
          async.elapse(const Duration(seconds: 90));
          final int channelsAfterWait = channels.length;
          async.elapse(const Duration(seconds: 90));
          expect(
            channels.length,
            channelsAfterWait,
            reason: 'no lingering reconnect timer eventually fired on its own',
          );
        });
      });

      test('disconnect() called while a fresh subscribe() is still mid-connect fails that subscribe with an error '
          'rather than leaving its stream hanging forever', () {
        fakeAsync((FakeAsync async) {
          final FakeWebSocketChannel channel = FakeWebSocketChannel();
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async => 'token',
            channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
          );

          final List<Object> errors = <Object>[];
          bool done = false;
          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: errors.add, onDone: () => done = true);
          async.flushMicrotasks();
          // Never emit connection_ack — the connect is still pending when
          // disconnect() arrives, exactly as it would if the app
          // backgrounds before a cold-start subscribe's handshake finishes.

          unawaited(client.disconnect());
          async.flushMicrotasks();

          expect(
            errors,
            hasLength(1),
            reason: 'the awaiting subscribe() must not hang forever',
          );
          expect(errors.single, isA<InternalError>());
          expect(done, isTrue);

          // No lingering reconnect activity either — a subscribe() that
          // never registered (it failed before reaching `_subscriptions`)
          // has nothing for the ladder to retry.
          async.elapse(const Duration(seconds: 90));
          expect(
            channel.closeCallCount,
            1,
            reason: 'no redundant second close() call',
          );
        });
      });

      test('reconnectNow() while a ladder-triggered reconnect attempt is already mid-connect does not start a second, '
          'concurrent attempt or send a duplicate start frame', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          int tokenFetchCount = 0;
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async {
              tokenFetchCount++;
              return 'reconnect-token-$tokenFetchCount';
            },
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          // The transport dies and the ladder's own Timer fires, starting
          // its own (non-queued) `_attemptReconnect()` — which has opened
          // a second channel and is now awaiting *its* connection_ack.
          channels.single.emitError(StateError('socket reset'));
          async.flushMicrotasks();
          async.elapse(const Duration(milliseconds: 1300));
          async.flushMicrotasks();
          expect(channels, hasLength(2));
          expect(tokenFetchCount, 1);

          // A foreground event arrives while that attempt is still
          // in-flight (no ack yet).
          unawaited(client.reconnectNow());
          async.flushMicrotasks();

          expect(
            channels,
            hasLength(2),
            reason: 'no second, concurrent connect attempt was opened',
          );
          expect(
            tokenFetchCount,
            1,
            reason: 'reconnectNow() must not fetch a second token for an already in-flight attempt',
          );

          // Let the in-flight attempt's own connect succeed.
          channels.last.emit(const <String, Object?>{'type': 'connection_ack'});
          async.flushMicrotasks();

          final int startFrameCount = channels.last.sentFrames
              .where((Map<String, Object?> f) => f['type'] == 'start')
              .length;
          expect(
            startFrameCount,
            1,
            reason: 'no duplicate start frame from a second, concurrent resubscribe-all',
          );
        });
      });

      test('disconnect() closes the transport immediately even while a queued reconnectNow() handshake is still pending '
          '— it does not wait behind it for the connect timeout', () {
        fakeAsync((FakeAsync async) {
          final List<FakeWebSocketChannel> channels = <FakeWebSocketChannel>[];
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            idTokenProvider: () async => 'token',
            channelFactory: (Uri uri, {Iterable<String>? protocols}) {
              final FakeWebSocketChannel channel = FakeWebSocketChannel();
              channels.add(channel);
              return channel;
            },
          );

          client
              .subscribe(
                query: _query,
                variables: <String, Object?>{'householdId': 'a'},
                idToken: 't',
              )
              .listen((_) {}, onError: (Object _) {});
          async.flushMicrotasks();
          channels.single.emit(const <String, Object?>{
            'type': 'connection_ack',
          });
          async.flushMicrotasks();

          // Background, then foreground — reconnectNow() opens a new
          // channel and is awaiting its own connection_ack (never sent).
          unawaited(client.disconnect());
          async.flushMicrotasks();
          unawaited(client.reconnectNow());
          async.flushMicrotasks();
          expect(channels, hasLength(2));
          expect(
            channels.last.closed,
            isFalse,
            reason: 'the reconnectNow() attempt is still mid-handshake',
          );

          // Immediately backgrounded again, before that handshake
          // resolves. This second disconnect() is queued behind the
          // first, already-completed one, but must not itself wait behind
          // reconnectNow()'s still-pending connect — it should close the
          // transport right away, well before the 10s connect timeout.
          unawaited(client.disconnect());
          async.flushMicrotasks();

          expect(
            channels.last.closed,
            isTrue,
            reason: 'disconnect() must abort an in-flight handshake immediately, not wait for it to time out',
          );

          // No lingering connect-timeout Timer either — advancing past
          // where it would have fired must not trigger any further
          // channel activity.
          async.elapse(const Duration(seconds: 15));
          expect(channels, hasLength(2));
        });
      });
    });

    test('a real channel error immediately followed by the keep-alive watchdog firing does not crash or double-execute', () {
      fakeAsync((FakeAsync async) {
        // Holds the first teardown's own `sink.close()` open — not a real
        // socket delay, but the closest this harness can get to a genuine
        // still-in-flight first teardown when a second trigger arrives.
        //
        // Honest limitation, found while building this test (not fixed by
        // adding more gating — this is Dart's own scheduling, not a bug):
        // `_subscriptions.remove(id)` inside `onCancel` runs purely via
        // microtasks with no real I/O in this harness, and Dart drains the
        // *entire* microtask queue before firing any due `Timer` — so by
        // the time the watchdog's `elapse()` below actually fires it,
        // `onCancel` has already cleared `_subscriptions`, closing the
        // exact race window `_isTearingDown`'s top-of-method checks exist
        // for. This test therefore cannot be made to fail by deleting
        // those specific `if (_isTearingDown) return;` lines — confirmed
        // by actually deleting them locally and re-running this test,
        // which still passed unchanged. What it *does* still verify, and would
        // fail without, is the underlying invariant those guards protect:
        // a second real trigger arriving mid-teardown must not corrupt
        // state or double-execute the close. Kept as a real regression
        // test for that invariant and as a plausible-scenario smoke test,
        // with the guards themselves justified as defense-in-depth for
        // timing this fake, instant-everything channel cannot reproduce
        // (real socket I/O has genuine, variable latency `sink.close()`
        // here does not).
        final Completer<void> closeGate = Completer<void>();
        final FakeWebSocketChannel channel = FakeWebSocketChannel()
          ..closeGate = closeGate.future;
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {}, onError: errors.add);
        async.flushMicrotasks();
        channel.emit(<String, Object?>{
          'type': 'connection_ack',
          'payload': <String, Object?>{'connectionTimeoutMs': 1000},
        });
        async.flushMicrotasks();

        // Trigger #1: a real channel error, held open by `closeGate`.
        channel.emitError(StateError('socket reset'));

        // Trigger #2: the keep-alive watchdog's own, independent `Timer`
        // firing shortly after.
        async.elapse(const Duration(seconds: 2));

        // Let trigger #1's own close() actually finish now.
        closeGate.complete();
        async.flushMicrotasks();

        // The subscriber survives a transient failure (W8 S3's inverted
        // close contract) — what this test actually verifies is that the
        // transport was closed exactly once despite two independent
        // triggers racing each other, no corruption, no double-execution,
        // no crash from either.
        expect(errors, isEmpty);
        expect(
          channel.closeCallCount,
          1,
          reason: 'no redundant second close() call',
        );
      });
    });

    test('a sink.close() failure during teardown still resets state — the client is not permanently wedged', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel()
        ..closeError = StateError('already broken');
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final List<Object> firstErrors = <Object>[];
      final StreamSubscription<Response> first = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: firstErrors.add);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      // The teardown's own `sink.close()` throws — swallowed as
      // best-effort, but if `_isTearingDown` were left stuck `true` by it
      // (the code-reviewer MEDIUM finding this covers), every subsequent
      // call in this test would silently no-op instead of reconnecting.
      // The subscriber itself survives (W8 S3's inverted close contract).
      channel.emitError(StateError('socket reset'));
      await pumpEventQueue();
      expect(firstErrors, isEmpty);
      await first.cancel();

      // A fresh subscribe — proof the client is not wedged: it starts a
      // real new connect attempt (a second `connection_init`, after the
      // first one from the initial subscribe above) rather than treating
      // the prior teardown as unfinished and silently doing nothing. The
      // client's `channelFactory` always returns this same `channel`
      // (fixed at construction), so this is still the throwing channel —
      // irrelevant here, since the assertion is only about a fresh
      // connect attempt actually being *made*, not about it succeeding.
      final List<Response> secondEvents = <Response>[];
      final StreamSubscription<Response> second = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'b'},
            idToken: 't',
          )
          .listen(secondEvents.add);
      addTearDown(second.cancel);
      await pumpEventQueue();

      final int initCount = channel.sentFrames
          .where((Map<String, Object?> f) => f['type'] == 'connection_init')
          .length;
      expect(
        initCount,
        2,
        reason:
            'a second, genuinely fresh connect attempt — not a wedged no-op',
      );
    });

    test('connection_ack carrying connectionTimeoutMs sets the keep-alive window to that value — silence just past it tears the connection down', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        bool done = false;
        client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {}, onError: errors.add, onDone: () => done = true);
        async.flushMicrotasks();
        channel.emit(<String, Object?>{
          'type': 'connection_ack',
          'payload': <String, Object?>{'connectionTimeoutMs': 5000},
        });
        async.flushMicrotasks();

        // Just under the server-supplied 5s window: still silent, still alive.
        async.elapse(const Duration(milliseconds: 4900));
        expect(errors, isEmpty);
        expect(done, isFalse);

        // Just past it, with no further traffic in between.
        async.elapse(const Duration(milliseconds: 200));
        // The subscriber survives — the keep-alive timeout routes through
        // the same transient-failure path as a real socket error (W8 S3's
        // inverted close contract), so this is not subscriber-visible.
        expect(errors, isEmpty);
        expect(done, isFalse);

        // What *is* observable: the real transport is actually torn down,
        // not merely local bookkeeping cleared — an orphaned, still-open
        // socket left connected to AppSync indefinitely was the
        // Flutter-review HIGH finding this covers. One more flush: the
        // timeout's own teardown chain (`_channelSubscription.cancel()`
        // then `_channel.sink.close()`) is itself async, and its
        // completion is a further microtask beyond the `elapse` call that
        // fired the Timer.
        async.flushMicrotasks();
        expect(channel.closed, isTrue);
      });
    });

    test('connection_ack with no connectionTimeoutMs falls back to the documented default window', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {}, onError: errors.add);
        async.flushMicrotasks();
        channel.emit(const <String, Object?>{'type': 'connection_ack'});
        async.flushMicrotasks();

        // Just under the documented 2-minute default.
        async.elapse(const Duration(minutes: 1, seconds: 59));
        expect(errors, isEmpty);

        async.elapse(const Duration(seconds: 2));
        // The subscriber survives (W8 S3's inverted close contract) — the
        // transport being actually torn down is the observable signal.
        async.flushMicrotasks();
        expect(errors, isEmpty);
        expect(channel.closed, isTrue);
      });
    });

    test('a ka frame resets the keep-alive watchdog', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {}, onError: errors.add);
        async.flushMicrotasks();
        channel.emit(<String, Object?>{
          'type': 'connection_ack',
          'payload': <String, Object?>{'connectionTimeoutMs': 5000},
        });
        async.flushMicrotasks();

        // Just under the window, then a `ka` — this must push the deadline
        // out again rather than the watchdog firing on the *original*
        // schedule.
        async.elapse(const Duration(milliseconds: 4900));
        channel.emit(const <String, Object?>{'type': 'ka'});
        async.flushMicrotasks();
        async.elapse(const Duration(milliseconds: 4900));
        expect(
          errors,
          isEmpty,
          reason: 'the ka should have reset the 5s window',
        );

        async.elapse(const Duration(milliseconds: 200));
        async.flushMicrotasks();
        // The subscriber survives (W8 S3's inverted close contract) — the
        // transport being torn down is the observable "did it actually fire"
        // signal now that a keep-alive timeout no longer errors the caller.
        expect(errors, isEmpty);
        expect(
          channel.closed,
          isTrue,
          reason: 'now genuinely silent past the reset window',
        );
      });
    });

    test('a data frame also resets the keep-alive watchdog — any traffic proves liveness, not only ka', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {}, onError: errors.add);
        async.flushMicrotasks();
        channel.emit(<String, Object?>{
          'type': 'connection_ack',
          'payload': <String, Object?>{'connectionTimeoutMs': 5000},
        });
        async.flushMicrotasks();
        final String id = channel.sentFrames.last['id']! as String;

        async.elapse(const Duration(milliseconds: 4900));
        channel.emit(<String, Object?>{
          'type': 'data',
          'id': id,
          'payload': <String, Object?>{
            'data': <String, Object?>{
              'onPantryChanged': <String, Object?>{'id': 'item-1'},
            },
          },
        });
        async.flushMicrotasks();
        async.elapse(const Duration(milliseconds: 4900));

        expect(
          errors,
          isEmpty,
          reason: 'the data frame should have reset the window too',
        );
      });
    });

    test('start_ack for a known, still-registered id is recorded', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {});
      addTearDown(sub.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();
      final String id = channel.sentFrames.last['id']! as String;

      expect(client.isSubscriptionAcknowledged(id), isFalse);

      channel.emit(<String, Object?>{'type': 'start_ack', 'id': id});
      await pumpEventQueue();

      expect(client.isSubscriptionAcknowledged(id), isTrue);
    });

    test('start_ack for an unknown id is ignored, not recorded', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {});
      addTearDown(sub.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      channel.emit(const <String, Object?>{
        'type': 'start_ack',
        'id': 'sub-never-registered',
      });
      await pumpEventQueue();

      expect(
        client.isSubscriptionAcknowledged('sub-never-registered'),
        isFalse,
      );
    });

    test('a start_ack from before a disconnect is cleared — a reconnect must not inherit a stale acknowledgment', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        idTokenProvider: () async => 'fresh-token',
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: (Object _) {});
      addTearDown(sub.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();
      final String id = channel.sentFrames.last['id']! as String;

      channel.emit(<String, Object?>{'type': 'start_ack', 'id': id});
      await pumpEventQueue();
      expect(client.isSubscriptionAcknowledged(id), isTrue);

      // A real channel error tears the connection down, same as the
      // keep-alive watchdog does — either path must clear this state.
      channel.emitError(StateError('socket reset'));
      await pumpEventQueue();

      expect(
        client.isSubscriptionAcknowledged(id),
        isFalse,
        reason: 'the same id string must not read as acknowledged on a connection it was never confirmed on',
      );
    });

    test(
      'an unrecognised frame type is still tolerated — no crash, no error',
      () async {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          idTokenProvider: () async => 'fresh-token',
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        final StreamSubscription<Response> sub = client
            .subscribe(
              query: _query,
              variables: <String, Object?>{'householdId': 'a'},
              idToken: 't',
            )
            .listen((_) {}, onError: errors.add);
        addTearDown(sub.cancel);
        await pumpEventQueue();
        channel.emit(const <String, Object?>{'type': 'connection_ack'});
        await pumpEventQueue();

        channel.emit(const <String, Object?>{'type': 'some_future_frame_type'});
        await pumpEventQueue();

        expect(errors, isEmpty);
      },
    );
  });
}
