// Widget-level debounce tests for `OfflineBanner` (E2E_MVP_PLAN.md
// §18.2.7/D7, §18.3 S7's own RED-test list).
//
// Uses `tester.pump(duration)` throughout, not `fake_async` directly:
// `testWidgets` already runs its whole body inside `flutter_test`'s own fake
// async zone, so a plain `Timer` (as `OfflineBanner` uses internally) is
// already faked, and `pump(duration)` is this codebase's standing way to
// advance it inside a widget test — the same reason
// `subscription_lifecycle_observer_test.dart` reaches for `pump()` rather
// than a real clock.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/graphql/subscription_client.dart'
    as subscription_client;
import 'package:mobile/shared/ui/components/offline_banner.dart';

Widget _wrap(
  ValueNotifier<subscription_client.ConnectionState> connectionState,
) {
  return MaterialApp(
    home: OfflineBanner(
      connectionState: connectionState,
      child: const Scaffold(body: Text('content')),
    ),
  );
}

void main() {
  group('OfflineBanner', () {
    testWidgets('invisible while connected', (WidgetTester tester) async {
      final ValueNotifier<subscription_client.ConnectionState> state =
          ValueNotifier<subscription_client.ConnectionState>(
            subscription_client.ConnectionState.connected,
          );

      await tester.pumpWidget(_wrap(state));

      expect(find.byKey(OfflineBanner.bannerKey), findsNothing);
    });

    testWidgets(
      'invisible immediately after disconnected begins, until the debounce '
      'elapses',
      (WidgetTester tester) async {
        final ValueNotifier<subscription_client.ConnectionState> state =
            ValueNotifier<subscription_client.ConnectionState>(
              subscription_client.ConnectionState.connected,
            );

        await tester.pumpWidget(_wrap(state));

        state.value = subscription_client.ConnectionState.disconnected;
        await tester.pump();

        expect(find.byKey(OfflineBanner.bannerKey), findsNothing);

        await tester.pump(
          offlineBannerDebounce - const Duration(milliseconds: 1),
        );

        expect(find.byKey(OfflineBanner.bannerKey), findsNothing);
      },
    );

    testWidgets('visible once the debounce elapses while still disconnected', (
      WidgetTester tester,
    ) async {
      final ValueNotifier<subscription_client.ConnectionState> state =
          ValueNotifier<subscription_client.ConnectionState>(
            subscription_client.ConnectionState.connected,
          );

      await tester.pumpWidget(_wrap(state));

      state.value = subscription_client.ConnectionState.disconnected;
      await tester.pump();
      await tester.pump(offlineBannerDebounce);

      expect(find.byKey(OfflineBanner.bannerKey), findsOneWidget);
    });

    testWidgets(
      'invisible again immediately on the next connected value, with no '
      'trailing debounce',
      (WidgetTester tester) async {
        final ValueNotifier<subscription_client.ConnectionState> state =
            ValueNotifier<subscription_client.ConnectionState>(
              subscription_client.ConnectionState.connected,
            );

        await tester.pumpWidget(_wrap(state));

        state.value = subscription_client.ConnectionState.disconnected;
        await tester.pump();
        await tester.pump(offlineBannerDebounce);
        expect(find.byKey(OfflineBanner.bannerKey), findsOneWidget);

        state.value = subscription_client.ConnectionState.connected;
        await tester.pump();

        expect(find.byKey(OfflineBanner.bannerKey), findsNothing);
      },
    );

    testWidgets('never shown for connecting, even past the debounce window', (
      WidgetTester tester,
    ) async {
      final ValueNotifier<subscription_client.ConnectionState> state =
          ValueNotifier<subscription_client.ConnectionState>(
            subscription_client.ConnectionState.connected,
          );

      await tester.pumpWidget(_wrap(state));

      state.value = subscription_client.ConnectionState.connecting;
      await tester.pump();
      await tester.pump(offlineBannerDebounce + const Duration(seconds: 5));

      expect(find.byKey(OfflineBanner.bannerKey), findsNothing);
    });

    testWidgets(
      'a disconnected blip that recovers before the debounce elapses never '
      'shows the banner',
      (WidgetTester tester) async {
        final ValueNotifier<subscription_client.ConnectionState> state =
            ValueNotifier<subscription_client.ConnectionState>(
              subscription_client.ConnectionState.connected,
            );

        await tester.pumpWidget(_wrap(state));

        state.value = subscription_client.ConnectionState.disconnected;
        await tester.pump();
        await tester.pump(
          offlineBannerDebounce - const Duration(milliseconds: 1),
        );

        state.value = subscription_client.ConnectionState.connecting;
        await tester.pump();
        await tester.pump(const Duration(seconds: 10));

        expect(find.byKey(OfflineBanner.bannerKey), findsNothing);
      },
    );

    testWidgets(
      'stays invisible past the debounce window when the listenable starts '
      'and stays at its default disconnected value — no subscription was '
      'ever attempted, so there is nothing to report as offline '
      '(AppSyncSubscriptionClient defaults to disconnected before the first '
      'subscribe() call, and reconnectNow() no-ops with zero subscribers)',
      (WidgetTester tester) async {
        final ValueNotifier<subscription_client.ConnectionState> state =
            ValueNotifier<subscription_client.ConnectionState>(
              subscription_client.ConnectionState.disconnected,
            );

        await tester.pumpWidget(_wrap(state));
        await tester.pump(offlineBannerDebounce + const Duration(seconds: 5));

        expect(find.byKey(OfflineBanner.bannerKey), findsNothing);
      },
    );

    testWidgets('shows the banner once a real disconnect follows at least one '
        'connection attempt, even though the listenable started at the '
        'default disconnected value', (WidgetTester tester) async {
      final ValueNotifier<subscription_client.ConnectionState> state =
          ValueNotifier<subscription_client.ConnectionState>(
            subscription_client.ConnectionState.disconnected,
          );

      await tester.pumpWidget(_wrap(state));

      state.value = subscription_client.ConnectionState.connecting;
      await tester.pump();
      state.value = subscription_client.ConnectionState.connected;
      await tester.pump();
      state.value = subscription_client.ConnectionState.disconnected;
      await tester.pump();
      await tester.pump(offlineBannerDebounce);

      expect(find.byKey(OfflineBanner.bannerKey), findsOneWidget);
    });

    testWidgets(
      'removes the top MediaQuery padding from child once visible, so a '
      "descendant SafeArea doesn't pad for the notch/status bar a second "
      "time on top of the banner's own SafeArea",
      (WidgetTester tester) async {
        final ValueNotifier<subscription_client.ConnectionState> state =
            ValueNotifier<subscription_client.ConnectionState>(
              subscription_client.ConnectionState.connected,
            );
        double? observedTopPadding;

        await tester.pumpWidget(
          MediaQuery(
            data: const MediaQueryData(padding: EdgeInsets.only(top: 44)),
            child: MaterialApp(
              home: OfflineBanner(
                connectionState: state,
                child: Builder(
                  builder: (BuildContext context) {
                    observedTopPadding = MediaQuery.paddingOf(context).top;
                    return const Scaffold(body: Text('content'));
                  },
                ),
              ),
            ),
          ),
        );

        expect(observedTopPadding, 44);

        state.value = subscription_client.ConnectionState.disconnected;
        await tester.pump();
        await tester.pump(offlineBannerDebounce);

        expect(find.byKey(OfflineBanner.bannerKey), findsOneWidget);
        expect(observedTopPadding, 0);
      },
    );

    testWidgets(
      'unmounting mid-debounce cancels the pending timer cleanly — no late '
      'setState after the tree is torn down',
      (WidgetTester tester) async {
        final ValueNotifier<subscription_client.ConnectionState> state =
            ValueNotifier<subscription_client.ConnectionState>(
              subscription_client.ConnectionState.connected,
            );

        await tester.pumpWidget(_wrap(state));

        state.value = subscription_client.ConnectionState.disconnected;
        await tester.pump();
        await tester.pump(
          offlineBannerDebounce - const Duration(milliseconds: 1),
        );

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump(const Duration(seconds: 5));

        expect(tester.takeException(), isNull);
      },
    );
  });
}
