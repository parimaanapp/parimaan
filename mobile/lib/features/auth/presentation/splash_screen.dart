import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/spacing.dart';
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

  /// The mark (green square, प glyph) above the wordmark below it — same
  /// treatment as `SignInScreen.markKey`.
  static const Key markKey = Key('splash-mark');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Watched, not read: dropping the subscription would let Riverpod dispose
    // the controller mid-resolution while this is the only screen mounted.
    ref.watch(authControllerProvider);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Image.asset(
              'assets/branding/parimaan-mark-1024.png',
              key: markKey,
              width: 72,
              height: 72,
            ),
            const SizedBox(height: AppSpacing.s4),
            const Text(
              wordmark,
              style: TextStyle(
                fontFamily: AppFontFamily.wordmark,
                fontSize: 40,
                height: 44 / 40,
                fontWeight: FontWeight.w500,
                color: AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
