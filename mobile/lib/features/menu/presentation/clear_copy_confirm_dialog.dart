import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// The confirm gate every W14 S8 destructive/replacing action shows before
/// calling `clearMenuDay`/`clearMenuWeek`/`copyMenuDay`/`copyMenuWeek`
/// (E2E_MVP_PLAN.md §20.2.8/§20.3, D8) — one shared dialog for all four,
/// distinguished only by [title]/[body]/[confirmLabel], since all four
/// share the identical shape: a plain-language description of what's about
/// to happen, a Cancel that calls nothing, and a single confirm action that
/// fires exactly one mutation. [isDestructive] picks the confirm button's
/// styling — `true` for the two `clear*` actions (irreversible deletion,
/// matching `RegenerateConfirmDialog`'s own destructive styling), `false`
/// for the two `copy*` actions (additive only — a copy never deletes
/// anything, so it doesn't read as "destructive" even though it's still
/// confirm-gated per the plan's flagged placement call).
///
/// Returns `true` only if the user affirmatively tapped the confirm button.
/// Cancel — and dismissing the barrier — both resolve to `false` and call
/// nothing, same `showDialog<bool>() ?? false` shape as
/// `showRegenerateConfirmDialog`.
Future<bool> showClearCopyConfirmDialog({
  required BuildContext context,
  required String title,
  required String body,
  required String confirmLabel,
  bool isDestructive = false,
}) async {
  final bool? confirmed = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => ClearCopyConfirmDialog(
      title: title,
      body: body,
      confirmLabel: confirmLabel,
      isDestructive: isDestructive,
    ),
  );
  return confirmed ?? false;
}

class ClearCopyConfirmDialog extends StatelessWidget {
  const ClearCopyConfirmDialog({
    super.key,
    required this.title,
    required this.body,
    required this.confirmLabel,
    this.isDestructive = false,
  });

  final String title;
  final String body;
  final String confirmLabel;
  final bool isDestructive;

  static const Key cancelButtonKey = Key('clear-copy-confirm-cancel');
  static const Key confirmButtonKey = Key('clear-copy-confirm-confirm');

  @override
  Widget build(BuildContext context) => Dialog(
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(borderRadius: AppRadius.borderL),
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.s3),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            title,
            style: AppTypography.title.copyWith(color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.s1),
          Text(
            body,
            style: AppTypography.label.copyWith(color: AppColors.inkMid),
          ),
          const SizedBox(height: AppSpacing.s3),
          Row(
            children: <Widget>[
              Expanded(
                child: PButton(
                  key: cancelButtonKey,
                  label: 'Cancel',
                  variant: PButtonVariant.secondary,
                  onPressed: () => Navigator.of(context).pop(false),
                ),
              ),
              const SizedBox(width: AppSpacing.s2),
              Expanded(
                child: PButton(
                  key: confirmButtonKey,
                  label: confirmLabel,
                  variant: isDestructive
                      ? PButtonVariant.destructive
                      : PButtonVariant.primary,
                  onPressed: () => Navigator.of(context).pop(true),
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
