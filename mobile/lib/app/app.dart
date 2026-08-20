import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../shared/ui/theme.dart';
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
    return ProviderScope(overrides: overrides, child: const _RoutedApp());
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
