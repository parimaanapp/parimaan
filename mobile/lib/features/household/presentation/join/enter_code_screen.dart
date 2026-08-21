import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/errors/app_error.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/invite_code.dart';
import '../../state/join_household_controller.dart';
import '../../state/pending_join_code_controller.dart';
import '../household_error_copy.dart';
import 'invite_code_field.dart';

/// Wireframe screen 3.1 — "Join a household".
///
/// ## THE design decision in this slice: "Join" joins
///
/// Tapping **Join** here calls `Mutation.joinHousehold` immediately. Screen 3.2
/// is therefore a *post-hoc* confirmation — "here is the household you just
/// joined" — not a pre-flight one.
///
/// This was forced, and the alternative was worse. The schema has **no query
/// that resolves an invite code to a household without joining it**:
/// `joinHousehold` is the only operation that accepts a code, and it enrolls
/// the caller as a side effect. That absence is deliberate on the server's part,
/// not an oversight — a "preview this household by code" query would be an
/// oracle letting anyone probe strangers' households with guessed codes, which
/// is the exact thing `RATE_LIMITED` exists to make expensive.
///
/// So a pre-flight 3.2 could only ever render the six characters the user just
/// typed, under a heading asking them to confirm the thing they had already
/// confirmed by typing it. That is a tap that carries no information — the
/// definition of a bad confirmation step. Calling the mutation first means 3.2
/// shows the **real** household: its name, its member count, its dietary and
/// cuisine summary. The confirmation becomes worth reading precisely because
/// the join already happened.
///
/// What makes this safe rather than merely convenient is that joining is
/// **reversible and idempotent**. `leaveHousehold` undoes it, is itself
/// idempotent, and needs no primary's permission; re-joining the same
/// household is a no-op rather than a duplicate membership. So 3.2's ghost
/// button is a real undo, not a cancel that cancels nothing — see
/// `ConfirmJoinScreen`.
///
/// The button says "Join" and joining is what it does. The design to avoid was
/// the one where a button labelled "Join" does not join.
class EnterCodeScreen extends ConsumerStatefulWidget {
  const EnterCodeScreen({super.key});

  static const Key joinButtonKey = Key('enter-code-join');
  static const Key errorKey = Key('enter-code-error');

  static const String topBarTitle = 'Join a household';
  static const String heading = 'Enter the invite code';

  /// Literal wireframe copy. It names the excluded glyphs because the whole
  /// point of the restricted alphabet is that a code read aloud or copied off
  /// a screenshot is unambiguous.
  static const String hint =
      '$inviteCodeLength characters. Not case-sensitive. No zeros, O, I, or L.';

  @override
  ConsumerState<EnterCodeScreen> createState() => _EnterCodeScreenState();
}

class _EnterCodeScreenState extends ConsumerState<EnterCodeScreen> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    // A deep-linked code is *prefilled*, never submitted. The user still has
    // to press Join — see `join_deep_link.dart` for why an auto-join would be
    // a one-tap account-linking attack.
    //
    // Read here, cleared one frame later. Riverpod forbids *modifying* a
    // provider during a widget life-cycle, so `take()` — which reads and
    // clears in one step — cannot be called from `initState`. Splitting the
    // two is not merely a workaround: the code must stay pending until this
    // screen has actually rendered with it, because the router's resume
    // redirect keys off exactly that value. Clearing it any earlier would let
    // the redirect fire again before the field was ever shown.
    final String? pending = ref.read(pendingJoinCodeControllerProvider);
    if (pending != null) {
      _controller.text = pending;
      WidgetsBinding.instance.addPostFrameCallback((Duration _) {
        if (mounted) {
          ref.read(pendingJoinCodeControllerProvider.notifier).clear();
        }
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _join() async {
    _focusNode.unfocus();
    final JoinOutcome outcome = await ref
        .read(joinHouseholdControllerProvider.notifier)
        .join(_controller.text);

    if (!mounted) {
      return;
    }
    switch (outcome) {
      case JoinOutcome.joined:
        context.go(AppRoutes.joinConfirm);
      case JoinOutcome.householdFull:
        context.go(AppRoutes.joinHouseholdFull);
      case JoinOutcome.failed:
        // Stay put: the message renders inline above the button, next to the
        // field the user needs to correct.
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Object?> join = ref.watch(joinHouseholdControllerProvider);
    final bool isBusy = join.isLoading;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: EnterCodeScreen.topBarTitle,
              onBack: () => _leave(context),
              backSemanticLabel: 'Back to the first-run screen',
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      EnterCodeScreen.heading,
                      style: AppTypography.title.copyWith(color: AppColors.ink),
                    ),
                    const SizedBox(height: AppSpacing.s0),
                    Text(
                      EnterCodeScreen.hint,
                      style: AppTypography.label.copyWith(
                        color: AppColors.inkMid,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s4),
                    InviteCodeField(
                      controller: _controller,
                      focusNode: _focusNode,
                      enabled: !isBusy,
                      onSubmitted: (String _) => _submitIfValid(),
                    ),
                  ],
                ),
              ),
            ),
            _ErrorLine(error: join.error),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              // Rebuilt on every keystroke so the button enables the moment the
              // sixth character lands.
              child: ValueListenableBuilder<TextEditingValue>(
                valueListenable: _controller,
                builder:
                    (BuildContext context, TextEditingValue value, Widget? _) =>
                        PButton(
                          key: EnterCodeScreen.joinButtonKey,
                          label: 'Join',
                          expand: true,
                          isLoading: isBusy,
                          // Disabled until the code is the right *shape*.
                          // Whether it exists is the server's call.
                          onPressed:
                              isBusy || validateInviteCode(value.text) != null
                              ? null
                              : _join,
                        ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _submitIfValid() {
    if (validateInviteCode(_controller.text) == null) {
      unawaited(_join());
    }
  }

  /// Backing out abandons any pending deep-linked code too, so it cannot
  /// re-arm the flow the user just left.
  void _leave(BuildContext context) {
    ref.read(pendingJoinCodeControllerProvider.notifier).clear();
    ref.read(joinHouseholdControllerProvider.notifier).reset();
    context.go(AppRoutes.firstRun);
  }
}

/// The inline server message, or nothing.
///
/// `NOT_FOUND` is the one failure this screen re-words: it is by far the most
/// likely outcome of a mistyped code, and the server's terse copy does not say
/// what to do about it.
class _ErrorLine extends StatelessWidget {
  const _ErrorLine({required this.error});

  final Object? error;

  @override
  Widget build(BuildContext context) {
    final Object? error = this.error;
    if (error == null) {
      return const SizedBox.shrink();
    }

    final String message = error is NotFoundError
        ? noSuchInviteCodeMessage
        : householdErrorMessage(error) ?? genericErrorMessage;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.s3,
        0,
        AppSpacing.s3,
        AppSpacing.s1,
      ),
      child: Text(
        message,
        key: EnterCodeScreen.errorKey,
        style: AppTypography.label.copyWith(color: AppColors.danger),
      ),
    );
  }
}
