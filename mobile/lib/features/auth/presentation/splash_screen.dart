import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/typography.dart';
import '../state/auth_controller.dart';

/// Shown while the persisted session is being resolved.
///
/// This screen never navigates. It watches [authControllerProvider] purely to
/// keep the resolution alive while it is on screen; the moment the state
/// settles, `goRouterProvider`'s `refreshListenable` fires and its `redirect`
/// moves the app to `/home` or `/sign-in`. That was verified rather than
/// assumed — `test/app/router_test.dart` boots the real router and asserts the
/// settled location for both signed-in and signed-out sessions.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  /// The wordmark, set in Noto Serif Devanagari — its only sanctioned use
  /// besides one appearance on the About screen.
  static const String wordmark = 'परिमाण';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Watched, not read: dropping the subscription would let Riverpod dispose
    // the controller mid-resolution while this is the only screen mounted.
    ref.watch(authControllerProvider);

    return const Scaffold(
      backgroundColor: AppColors.paper,
      body: Center(
        child: Text(
          wordmark,
          style: TextStyle(
            fontFamily: AppFontFamily.wordmark,
            fontSize: 40,
            height: 44 / 40,
            fontWeight: FontWeight.w500,
            color: AppColors.ink,
          ),
        ),
      ),
    );
  }
}
