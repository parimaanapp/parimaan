import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../shared/graphql/client.dart';
import '../shared/ui/components/offline_banner.dart';
import '../shared/ui/theme.dart';
import 'join_deep_link_listener.dart';
import 'router.dart';
import 'subscription_lifecycle_observer.dart';

/// The app root: a [ProviderScope] over the routed [MaterialApp].
///
/// [overrides] exists so the composition root can inject the real
/// `AmplifyAuthRepository` (see `main.dart`) and tests can inject a fake,
/// without either needing to reproduce this widget's wiring.
class ParimaanApp extends StatelessWidget {
  const ParimaanApp({super.key, this.overrides = const <Override>[]});

  final List<Override> overrides;

  @override
  Widget build(BuildContext context) {
    // The deep-link listener and the subscription-lifecycle observer both
    // wrap the router rather than living inside it: neither needs anything
    // but a `WidgetRef` and a place to be mounted for the app's whole life,
    // and keeping them outside means `goRouterProvider` has no dependency on
    // `app_links` or on `subscriptionClientProvider` — which is what lets
    // every router test build a real router with no platform channels or
    // GraphQL client available.
    return ProviderScope(
      overrides: overrides,
      child: const JoinDeepLinkListener(
        child: SubscriptionLifecycleObserver(child: _RoutedApp()),
      ),
    );
  }
}

class _RoutedApp extends ConsumerWidget {
  const _RoutedApp();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouter router = ref.watch(goRouterProvider);

    return MaterialApp.router(
      title: 'Parimaan',
      debugShowCheckedModeBanner: false,
      theme: parimaanTheme(),
      routerConfig: router,
      // Mounted once here, above the `Navigator` `MaterialApp.router` builds
      // internally — every screen/route/tab gets the offline banner with no
      // per-screen wiring (E2E_MVP_PLAN.md §18.2.7/D7, §18.3 S7). `builder`'s
      // `child` is the routed `Navigator`; `OfflineBanner` wraps it rather
      // than replacing it.
      builder: (BuildContext context, Widget? child) {
        return OfflineBanner(
          connectionState: ref
              .watch(subscriptionClientProvider)
              .connectionState,
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
