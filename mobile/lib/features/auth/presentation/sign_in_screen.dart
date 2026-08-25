import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/auth_session.dart';
import '../state/auth_controller.dart';
import 'auth_failure_copy.dart';

/// The only sign-in surface: one Google button, because the user pool has
/// exactly one identity provider and no password flow can be added to it
/// (`GOOGLE_ONLY_AUTH_FLOWS` in `infra/stacks/auth-stack.ts`).
class SignInScreen extends ConsumerWidget {
  const SignInScreen({super.key});

  /// Lets tests assert the *absence* of the error line, which `find.text`
  /// cannot express for copy that is conditionally built.
  static const Key errorKey = Key('sign-in-error');

  /// The mark (green square, प glyph) above the wordmark below it.
  static const Key markKey = Key('sign-in-mark');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AuthSession> auth = ref.watch(authControllerProvider);
    final bool isBusy = auth.isLoading;
    final String? errorMessage = authFailureMessage(auth.error);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Image.asset(
                'assets/branding/parimaan-mark-1024.png',
                key: SignInScreen.markKey,
                width: 72,
                height: 72,
              ),
              const SizedBox(height: AppSpacing.s4),
              Text(
                SignInScreen._wordmark,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: AppFontFamily.wordmark,
                  fontSize: 40,
                  height: 44 / 40,
                  fontWeight: FontWeight.w500,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: AppSpacing.s3),
              Text(
                'One kitchen, one plan.',
                textAlign: TextAlign.center,
                style: AppTypography.body.copyWith(color: AppColors.inkSoft),
              ),
              const SizedBox(height: AppSpacing.s5),
              // TODO(design-system): migrate to the shared `PButton` primary
              // variant once that component lands — it will own the focus ring
              // and the "one primary per screen" rule that `theme.dart`
              // deliberately does not encode. Until then this is the themed
              // ElevatedButton, not a bespoke style, so the migration is a
              // widget swap rather than a restyle.
              ElevatedButton(
                onPressed: isBusy
                    ? null
                    : () => ref
                          .read(authControllerProvider.notifier)
                          .signInWithGoogle(),
                child: Text(isBusy ? 'Signing in…' : 'Continue with Google'),
              ),
              if (errorMessage != null) ...<Widget>[
                const SizedBox(height: AppSpacing.s3),
                Text(
                  errorMessage,
                  key: errorKey,
                  textAlign: TextAlign.center,
                  style: AppTypography.label.copyWith(color: AppColors.danger),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  static const String _wordmark = 'परिमाण';
}
