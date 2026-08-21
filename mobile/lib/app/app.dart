import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../shared/ui/theme.dart';
import 'join_deep_link_listener.dart';
import 'router.dart';

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
    // The deep-link listener wraps the router rather than living inside it: it
    // only needs a `WidgetRef` and a place to be mounted for the app's whole
    // life, and keeping it outside means `goRouterProvider` has no dependency
    // on the `app_links` plugin — which is what lets every router test build a
    // real router with no platform channels available.
    return ProviderScope(
      overrides: overrides,
      child: const JoinDeepLinkListener(child: _RoutedApp()),
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
    );
  }
}
