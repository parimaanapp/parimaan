import 'package:flutter/material.dart';

import '../tokens.dart';

/// Toast tones. Each pairs a colour with a mandatory message, so colour is
/// never the only signal.
enum PToastTone { neutral, success, warning, danger, info }

/// Transient feedback — "added to pantry", "removed from list", "couldn't
/// reach the kitchen".
///
/// **Engineering call: the widget is pure; the transience is a wrapper.**
/// "Toast" names two different things at once — a look, and a lifecycle. A
/// stateless widget can own the first and cannot own the second: appearing,
/// waiting, and leaving need a timer, an overlay, and somewhere above the
/// current route to live. Splitting them is what keeps this component
/// golden-testable in isolation while still giving callers one obvious way to
/// show a toast:
///
///  * **[PToast] itself is a plain stateless visual component.** Given a
///    message it renders the surface and nothing else. It can be dropped into
///    any layout — including a golden test — and has no opinion about time.
///  * **[PToast.show] is the transience.** It hands the widget to
///    `ScaffoldMessenger` inside a deliberately invisible [SnackBar]
///    (transparent, elevation 0, floating) so the framework owns queueing,
///    dismissal, timing and the back-gesture, while [PToast] still owns every
///    pixel. Reimplementing that queueing on an `Overlay` would be a worse
///    version of code Flutter already ships.
///
/// [PToast.show] takes its [Duration] as a **required** argument rather than
/// defaulting: the motion token scale tops out at
/// [AppMotion.gentle] (360ms), which is an animation duration, not a
/// dwell time — there is no "how long should a toast stay up" token to reach
/// for, and inventing a literal here would be exactly the kind of unnamed
/// constant the token system exists to prevent.
class PToast extends StatelessWidget {
  const PToast({
    super.key,
    required this.message,
    this.tone = PToastTone.neutral,
    this.icon,
    this.actionLabel,
    this.onAction,
  }) : assert(
         actionLabel == null || onAction != null,
         'An action label with no callback is a dead control.',
       );

  /// Identifies the tone accent bar.
  static const Key accentKey = Key('p_toast_accent');

  /// The feedback copy. Always rendered — this is what keeps the tone's colour
  /// from being the only signal.
  final String message;

  final PToastTone tone;

  /// Optional leading glyph, supplied by the caller so this library never
  /// hard-codes an icon set.
  final IconData? icon;

  /// Optional inline action, e.g. "Undo".
  final String? actionLabel;

  /// Required whenever [actionLabel] is given.
  final VoidCallback? onAction;

  /// Shows [toast] over the nearest [ScaffoldMessenger] for [duration].
  ///
  /// See the class doc for why the [SnackBar] underneath is invisible and why
  /// [duration] has no default.
  static ScaffoldFeatureController<SnackBar, SnackBarClosedReason> show({
    required BuildContext context,
    required PToast toast,
    required Duration duration,
  }) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: toast,
      duration: duration,
      backgroundColor: Colors.transparent,
      elevation: 0,
      behavior: SnackBarBehavior.floating,
      padding: EdgeInsets.zero,
      animation: null,
      dismissDirection: DismissDirection.down,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final Color accent = _accentFor(tone);

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadius.borderM,
        // e1, "resting" — the level the token file assigns to popovers.
        boxShadow: AppElevation.e1,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.s2,
        vertical: AppSpacing.s2,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            key: accentKey,
            width: AppSpacing.s0,
            height: AppSizing.icon20,
            decoration: BoxDecoration(
              color: accent,
              borderRadius: AppRadius.borderXs,
            ),
          ),
          const SizedBox(width: AppSpacing.s2),
          if (icon != null) ...<Widget>[
            Icon(icon, size: AppSizing.icon20, color: accent),
            const SizedBox(width: AppSpacing.s1),
          ],
          Flexible(
            child: Text(
              message,
              style: AppTypography.body.copyWith(color: AppColors.ink),
            ),
          ),
          if (actionLabel != null) ...<Widget>[
            const SizedBox(width: AppSpacing.s2),
            _ToastAction(label: actionLabel!, onPressed: onAction!),
          ],
        ],
      ),
    );
  }
}

/// The inline action ("Undo"), styled as a ghost control.
class _ToastAction extends StatelessWidget {
  const _ToastAction({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    // A toast is a slim horizontal bar, so this can't be a fixed 44x44 box
    // the way `PTopBarBackButton`'s icon-only tap target is — a minimum
    // constraint instead guarantees the 44pt floor in both dimensions
    // without forcing the action to be square or widening it past what its
    // label needs.
    constraints: const BoxConstraints(
      minWidth: AppSizing.minTouchTargetWidth,
      minHeight: AppSizing.minTouchTargetHeight,
    ),
    child: Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: AppRadius.borderS,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.s1,
              vertical: AppSpacing.s0,
            ),
            child: Text(
              label,
              style: AppTypography.bodyStrong.copyWith(
                color: AppColors.terracottaDeep,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

Color _accentFor(PToastTone tone) {
  switch (tone) {
    case PToastTone.neutral:
      return AppColors.inkMid;
    case PToastTone.success:
      return AppColors.success;
    case PToastTone.warning:
      return AppColors.warning;
    case PToastTone.danger:
      return AppColors.danger;
    case PToastTone.info:
      return AppColors.info;
  }
}
