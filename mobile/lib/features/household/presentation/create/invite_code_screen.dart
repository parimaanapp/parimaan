import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/motion.dart';
import '../../../../shared/ui/radius.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../state/household_wizard_controller.dart';

/// Wireframe screen 2.7 — the invite code, shown once setup finishes.
///
/// The code is not fetched: `createHousehold` already returned it on screen
/// 2.1 and the wizard has been holding it since. A second round trip for a
/// value already in memory would be a ~30s cold-start wait for nothing.
///
/// **"Share ↗" copies rather than opening the OS share sheet.** A native share
/// sheet needs `share_plus` (or a platform channel); this slice is scoped
/// share_plus-free, and adding a third-party SDK for one button is a
/// dependency decision — plus a `security-reviewer` trigger under
/// `DEV_WORKFLOW.md` §2.3's "third-party SDK addition of any kind" — that
/// belongs to its own change. So both buttons copy, with different copy and
/// different toast text, and the button stays where the real share sheet will
/// land. `Clipboard` is `package:flutter/services.dart`, i.e. the SDK: no new
/// dependency.
class InviteCodeScreen extends ConsumerWidget {
  const InviteCodeScreen({super.key});

  static const Key codeKey = Key('invite-code-value');
  static const Key copyButtonKey = Key('invite-code-copy');
  static const Key shareButtonKey = Key('invite-code-share');
  static const Key doneButtonKey = Key('invite-code-done');
  static const Key missingCodeKey = Key('invite-code-missing');

  static const String headline = "You're the primary";
  static const String subhead = 'Share this code with up to 4 members.';

  static const String copiedToast = 'Copied';
  static const String sharedToast = 'Code copied — paste it wherever you like';

  /// A toast dwell time, which the motion token scale deliberately has no
  /// value for — `AppMotion` tops out at an *animation* duration. Named here
  /// rather than inlined as a literal at the call site, which is the closest
  /// this can get to the token discipline without inventing a token.
  static const Duration toastDuration = Duration(seconds: 2);

  /// The message "Share" puts on the clipboard: the code plus enough context
  /// to be intelligible when pasted into a family chat.
  static String shareMessage(String code) =>
      'Join our Parimaan household with invite code $code';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final HouseholdWizardData? draft = ref
        .watch(householdWizardControllerProvider)
        .valueOrNull;
    final String? code = draft?.inviteCode;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: code == null
              ? _MissingCode(key: missingCodeKey)
              : _InviteCodeBody(code: code),
        ),
      ),
    );
  }
}

class _InviteCodeBody extends StatelessWidget {
  const _InviteCodeBody({required this.code});

  final String code;

  Future<void> _copy(
    BuildContext context, {
    required String text,
    required String toast,
  }) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!context.mounted) {
      return;
    }
    PToast.show(
      context: context,
      toast: PToast(message: toast, tone: PToastTone.success),
      duration: InviteCodeScreen.toastDuration,
    );
  }

  @override
  Widget build(BuildContext context) => Column(
    mainAxisAlignment: MainAxisAlignment.center,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: <Widget>[
      Text(
        InviteCodeScreen.headline,
        textAlign: TextAlign.center,
        style: AppTypography.displayM.copyWith(color: AppColors.ink),
      ),
      const SizedBox(height: AppSpacing.s1),
      Text(
        InviteCodeScreen.subhead,
        textAlign: TextAlign.center,
        style: AppTypography.body.copyWith(color: AppColors.inkMid),
      ),
      const SizedBox(height: AppSpacing.s4),
      _CodePlaque(code: code),
      const SizedBox(height: AppSpacing.s4),
      Row(
        children: <Widget>[
          Expanded(
            child: PButton(
              key: InviteCodeScreen.copyButtonKey,
              label: 'Copy',
              variant: PButtonVariant.secondary,
              expand: true,
              onPressed: () => _copy(
                context,
                text: code,
                toast: InviteCodeScreen.copiedToast,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.s1),
          Expanded(
            child: PButton(
              key: InviteCodeScreen.shareButtonKey,
              label: 'Share ↗',
              expand: true,
              onPressed: () => _copy(
                context,
                text: InviteCodeScreen.shareMessage(code),
                toast: InviteCodeScreen.sharedToast,
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: AppSpacing.s2),
      PButton(
        key: InviteCodeScreen.doneButtonKey,
        label: 'Done',
        variant: PButtonVariant.ghost,
        expand: true,
        // `/home` is still the placeholder from the auth slice; the real
        // post-setup destination (the week plan) is a later slice, and routing
        // at a screen that does not exist would be worse than routing at an
        // honest placeholder.
        onPressed: () => context.go(AppRoutes.home),
      ),
    ],
  );
}

/// The dashed-border plaque the code sits in.
///
/// The dashed stroke is the one thing here with no token or component behind
/// it: the design system has no dashed-border primitive, and the wireframe
/// draws this box (and the "＋ add" affordances) with one. Rather than
/// hand-rolling a dash painter for a single decorative edge, this uses a solid
/// terracotta border at the same radius and weight — the plaque still reads as
/// a distinct, framed, brand-coloured object, which is what the dashes are
/// doing. Flagged as a design-system gap rather than absorbed silently.
class _CodePlaque extends StatelessWidget {
  const _CodePlaque({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) => AnimatedContainer(
    duration: AppMotion.quick,
    padding: const EdgeInsets.symmetric(
      horizontal: AppSpacing.s4,
      vertical: AppSpacing.s3,
    ),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: AppRadius.borderL,
      border: Border.all(color: AppColors.terracotta, width: 2),
    ),
    child: Text(
      code,
      key: InviteCodeScreen.codeKey,
      textAlign: TextAlign.center,
      // Mono, large, and tracked, per the wireframe. `AppTypography.mono` is
      // the token's size; the code is the one thing on this screen that has to
      // be read aloud character by character, so it is scaled up from it
      // rather than rendered at body size.
      style: AppTypography.mono.copyWith(
        color: AppColors.terracotta,
        fontSize: AppTypography.displayM.fontSize,
        letterSpacing: AppSpacing.s0,
      ),
    ),
  );
}

/// What renders if this screen is reached without a household — a deep link
/// straight to `/household/create/invite`, most plausibly.
///
/// An explicit way back rather than a blank screen, per the design system's
/// "no dead ends" rule that makes `PEmptyState.action` required.
class _MissingCode extends StatelessWidget {
  const _MissingCode({super.key});

  @override
  Widget build(BuildContext context) => Center(
    child: PEmptyState(
      headline: 'No household yet',
      body:
          'There is no invite code to show because no household has been set '
          'up on this device yet.',
      action: PButton(
        label: 'Set up a household',
        variant: PButtonVariant.secondary,
        onPressed: () => context.go(AppRoutes.createHouseholdName),
      ),
    ),
  );
}
