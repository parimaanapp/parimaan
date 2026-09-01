// Widget-level wiring test for `SubscriptionLifecycleObserver`.
//
// The reconnect/backoff/refetch behavior itself is exhaustively covered at
// the `AppSyncSubscriptionClient` level (`subscription_client_test.dart`,
// including its own `reconnectNow (W8 S4)` group) — this file only proves
// that a real `AppLifecycleState` transition, delivered the way the Flutter
// engine actually delivers one, reaches `disconnect()`/`reconnectNow()` on
// the right states.
//
// Uses `pump()` throughout, never `pumpAndSettle()`: `AppSyncSubscriptionClient`
// keeps a live `Timer` armed for as long as a connection is open (the
// connect-timeout timer, then — once acknowledged — the keep-alive
// watchdog), and `pumpAndSettle()`'s "keep pumping until nothing is
// scheduled" loop has no bound on how long it will keep advancing the
// binding's own fake clock chasing that, which in practice never actually
// settles. A fixed, small number of `pump()` calls is enough to flush the
// microtasks each step here needs (registering a subscription, connecting,
// tearing down) without depending on open-ended settling.

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/subscription_lifecycle_observer.dart';
import 'package:mobile/shared/graphql/client.dart';
import 'package:mobile/shared/graphql/subscription_client.dart';

import '../support/fake_web_socket_channel.dart';

const String _httpUrl =
    'https://abc.appsync-api.ap-south-1.amazonaws.com/graphql';
const String _query =
    'subscription OnPantryChanged(\$householdId: ID!) { onPantryChanged(householdId: \$householdId) { id } }';

/// A handful of zero-duration pumps — enough to drain the microtask chains
/// this file's own actions need (a `subscribe()` call reaching its
/// `onListen`, a fake-channel frame reaching `_handleRawMessage`, a queued
/// lifecycle operation reaching the front of `AppSyncSubscriptionClient`'s
/// own internal queue) without ever advancing the binding's fake clock, so a
/// still-open connection's own live timers are never at risk of firing
/// mid-test.
Future<void> _settle(WidgetTester tester) async {
  for (int i = 0; i < 5; i++) {
    await tester.pump();
  }
}

void main() {
  group('SubscriptionLifecycleObserver', () {
    testWidgets('paused disconnects the socket; resumed reconnects it', (
      WidgetTester tester,
    ) async {
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

      // A real subscriber, kept alive for the observer's whole lifecycle —
      // mirrors a real screen's subscription being active when the app
      // backgrounds/foregrounds.
      final StreamSubscription<Object?> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: (Object _) {});
      await _settle(tester);
      channels.single.emit(const <String, Object?>{'type': 'connection_ack'});
      await _settle(tester);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            subscriptionClientProvider.overrideWithValue(client),
          ],
          child: const SubscriptionLifecycleObserver(child: SizedBox()),
        ),
      );
      await _settle(tester);

      expect(
        channels,
        hasLength(1),
        reason: 'mounting the observer opens no connection of its own',
      );
      expect(channels.single.closed, isFalse);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await _settle(tester);

      expect(
        channels.single.closed,
        isTrue,
        reason: 'paused calls disconnect()',
      );

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await _settle(tester);

      expect(
        channels,
        hasLength(2),
        reason: 'resumed calls reconnectNow(), opening a fresh connection',
      );
      expect(channels.last.closed, isFalse);

      // Acknowledge the new connection — without this, `reconnectNow()`'s
      // own internal call chain stays parked awaiting a `connection_ack`
      // that never arrives, and (since `disconnect()`/`reconnectNow()` are
      // serialized against each other) the cleanup `disconnect()` call below
      // would queue up behind it and never run either.
      channels.last.emit(const <String, Object?>{'type': 'connection_ack'});
      await _settle(tester);

      // Tear everything down explicitly before the test ends: a live
      // connection owns a connect-timeout timer (and, once acknowledged, a
      // keep-alive watchdog too), and flutter_test's own pending-timer
      // invariant check fails any test that leaves one running at teardown.
      await sub.cancel();
      await client.disconnect();
      await _settle(tester);
    });

    testWidgets('inactive is ignored — it neither disconnects nor reconnects', (
      WidgetTester tester,
    ) async {
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

      final StreamSubscription<Object?> sub = client
          .subscribe(
            query: _query,
            variables: <String, Object?>{'householdId': 'a'},
            idToken: 't',
          )
          .listen((_) {}, onError: (Object _) {});
      await _settle(tester);
      channels.single.emit(const <String, Object?>{'type': 'connection_ack'});
      await _settle(tester);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            subscriptionClientProvider.overrideWithValue(client),
          ],
          child: const SubscriptionLifecycleObserver(child: SizedBox()),
        ),
      );
      await _settle(tester);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await _settle(tester);

      expect(channels, hasLength(1));
      expect(
        channels.single.closed,
        isFalse,
        reason: 'a momentary inactive state must not disconnect the socket',
      );

      // See the identical cleanup, and why it must happen explicitly here
      // rather than via `addTearDown`, in the test above.
      await sub.cancel();
      await client.disconnect();
      await _settle(tester);
    });
  });
}
