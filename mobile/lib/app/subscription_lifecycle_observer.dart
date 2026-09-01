import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../shared/graphql/client.dart';

/// Disconnects the app's single [AppSyncSubscriptionClient] on background and
/// reconnects it on foreground (W8 S4, §14.3 S4) — the app-lifecycle half of
/// what `subscription_client.dart`'s own class doc already promises: a
/// backgrounded socket is pure battery/Aurora-load cost for a screen nobody
/// is looking at (`HouseholdSyncPolicy`'s own idle-decay rationale, applied
/// here to the transport itself rather than a poll timer), and iOS will not
/// reliably fire background timers anyway, so the reconnect ladder must not
/// even try to run while backgrounded — `disconnect()` itself already
/// guarantees that (it cancels any pending reconnect timer).
///
/// `resumed` calls [AppSyncSubscriptionClient.reconnectNow] rather than
/// waiting for the ladder's own backoff: a user who just reopened the app
/// deserves an immediate retry, not whatever delay the ladder happened to be
/// sitting on. `paused`/`detached` call [AppSyncSubscriptionClient.disconnect].
/// `inactive`/`hidden` (a transient state — an incoming call, the app
/// switcher, a system dialog) are deliberately ignored: neither is "really"
/// backgrounded, and disconnecting on every momentary interruption would
/// turn brief inattention into a reconnect storm.
///
/// Reads [subscriptionClientProvider] lazily, only from inside
/// [didChangeAppLifecycleState] — never eagerly in `initState` — so mounting
/// this observer costs nothing in a widget tree that never overrides
/// [subscriptionClientProvider] (every existing `widget_test.dart` boot test,
/// none of which exercise GraphQL at all) unless a real lifecycle transition
/// actually fires.
class SubscriptionLifecycleObserver extends ConsumerStatefulWidget {
  const SubscriptionLifecycleObserver({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<SubscriptionLifecycleObserver> createState() =>
      _SubscriptionLifecycleObserverState();
}

class _SubscriptionLifecycleObserverState
    extends ConsumerState<SubscriptionLifecycleObserver>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(ref.read(subscriptionClientProvider).reconnectNow());
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        unawaited(ref.read(subscriptionClientProvider).disconnect());
      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
        break;
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
