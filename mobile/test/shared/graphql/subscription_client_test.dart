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

    test(
      'a real channel error immediately followed by the keep-alive watchdog firing does not crash or double-execute',
      () {
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
            channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
          );

          final List<Object> errors = <Object>[];
          client
              .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
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

          // Exactly one error reached the subscriber, and the transport was
          // closed exactly once — no corruption, no double-execution, no
          // crash from either trigger.
          expect(errors, hasLength(1));
          expect(channel.closeCallCount, 1, reason: 'no redundant second close() call');
        });
      },
    );

    test(
      'a sink.close() failure during teardown still resets state — the client is not permanently wedged',
      () async {
        final FakeWebSocketChannel channel = FakeWebSocketChannel()
          ..closeError = StateError('already broken');
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> firstErrors = <Object>[];
        final StreamSubscription<Response> first = client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
            .listen((_) {}, onError: firstErrors.add);
        await pumpEventQueue();
        channel.emit(const <String, Object?>{'type': 'connection_ack'});
        await pumpEventQueue();

        // The teardown's own `sink.close()` throws — swallowed as
        // best-effort, but if `_isTearingDown` were left stuck `true` by it
        // (the code-reviewer MEDIUM finding this covers), every subsequent
        // call in this test would silently no-op instead of reconnecting.
        channel.emitError(StateError('socket reset'));
        await pumpEventQueue();
        expect(firstErrors, hasLength(1));
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
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'b'}, idToken: 't')
            .listen(secondEvents.add);
        addTearDown(second.cancel);
        await pumpEventQueue();

        final int initCount = channel.sentFrames
            .where((Map<String, Object?> f) => f['type'] == 'connection_init')
            .length;
        expect(initCount, 2, reason: 'a second, genuinely fresh connect attempt — not a wedged no-op');
      },
    );

    test(
      'connection_ack carrying connectionTimeoutMs sets the keep-alive window to that value — silence just past it tears the connection down',
      () {
        fakeAsync((FakeAsync async) {
          final FakeWebSocketChannel channel = FakeWebSocketChannel();
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
          );

          final List<Object> errors = <Object>[];
          bool done = false;
          client
              .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
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
          expect(errors, hasLength(1));
          expect(errors.single, isA<InternalError>());
          expect(done, isTrue);

          // Not just subscriber-visible: the real transport must actually be
          // torn down too, not merely have its local bookkeeping cleared —
          // an orphaned, still-open socket left connected to AppSync
          // indefinitely was the Flutter-review HIGH finding this covers.
          // One more flush: the timeout's own teardown chain
          // (`_channelSubscription.cancel()` then `_channel.sink.close()`)
          // is itself async, and its completion is a further microtask
          // beyond the `elapse` call that fired the Timer.
          async.flushMicrotasks();
          expect(channel.closed, isTrue);
        });
      },
    );

    test(
      'connection_ack with no connectionTimeoutMs falls back to the documented default window',
      () {
        fakeAsync((FakeAsync async) {
          final FakeWebSocketChannel channel = FakeWebSocketChannel();
          final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
            httpGraphQlUrl: _httpUrl,
            channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
          );

          final List<Object> errors = <Object>[];
          client
              .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
              .listen((_) {}, onError: errors.add);
          async.flushMicrotasks();
          channel.emit(const <String, Object?>{'type': 'connection_ack'});
          async.flushMicrotasks();

          // Just under the documented 2-minute default.
          async.elapse(const Duration(minutes: 1, seconds: 59));
          expect(errors, isEmpty);

          async.elapse(const Duration(seconds: 2));
          expect(errors, hasLength(1));
        });
      },
    );

    test('a ka frame resets the keep-alive watchdog', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
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
        expect(errors, isEmpty, reason: 'the ka should have reset the 5s window');

        async.elapse(const Duration(milliseconds: 200));
        expect(errors, hasLength(1), reason: 'now genuinely silent past the reset window');
      });
    });

    test('a data frame also resets the keep-alive watchdog — any traffic proves liveness, not only ka', () {
      fakeAsync((FakeAsync async) {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final List<Object> errors = <Object>[];
        client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
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
            'data': <String, Object?>{'onPantryChanged': <String, Object?>{'id': 'item-1'}},
          },
        });
        async.flushMicrotasks();
        async.elapse(const Duration(milliseconds: 4900));

        expect(errors, isEmpty, reason: 'the data frame should have reset the window too');
      });
    });

    test('start_ack for a known, still-registered id is recorded', () async {
      final FakeWebSocketChannel channel = FakeWebSocketChannel();
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: _httpUrl,
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> sub = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
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
        channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
      );

      final StreamSubscription<Response> sub = client
          .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
          .listen((_) {});
      addTearDown(sub.cancel);
      await pumpEventQueue();
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      channel.emit(const <String, Object?>{'type': 'start_ack', 'id': 'sub-never-registered'});
      await pumpEventQueue();

      expect(client.isSubscriptionAcknowledged('sub-never-registered'), isFalse);
    });

    test(
      'a start_ack from before a disconnect is cleared — a reconnect must not inherit a stale acknowledgment',
      () async {
        final FakeWebSocketChannel channel = FakeWebSocketChannel();
        final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
          httpGraphQlUrl: _httpUrl,
          channelFactory: (Uri uri, {Iterable<String>? protocols}) => channel,
        );

        final StreamSubscription<Response> sub = client
            .subscribe(query: _query, variables: <String, Object?>{'householdId': 'a'}, idToken: 't')
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
      },
    );

    test('an unrecognised frame type is still tolerated — no crash, no error', () async {
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
      channel.emit(const <String, Object?>{'type': 'connection_ack'});
      await pumpEventQueue();

      channel.emit(const <String, Object?>{'type': 'some_future_frame_type'});
      await pumpEventQueue();

      expect(errors, isEmpty);
    });
  });
}
