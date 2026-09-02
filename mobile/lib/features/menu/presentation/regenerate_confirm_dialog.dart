import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// The confirm gate `AutoFillPreviewScreen`'s Accept action shows whenever
/// committing the proposal (`autoFillWeek(overwrite: true, ...)`) would
/// replace an existing UNMADE item already on the menu (W10 §16.2.7, D4).
/// Skipped entirely when the menu had no unmade items to begin with — there
/// is nothing to lose, so nothing to confirm.
///
/// **Not** shown by the free "Regenerate" action on the preview screen
/// itself, despite this file's name — regenerating only re-runs the dry-run
/// `autoFillPreview` query and writes nothing (D3), so it never needs
/// confirming. This dialog gates the ONE write path reachable from that
/// screen: `AutoFillPreviewScreen`'s Accept button calls `commitAutoFill`
/// only after this dialog resolves `true` (or was never shown at all).
///
/// The copy states plainly that MANUALLY-placed items are replaced too, not
/// only auto-fill's own earlier picks — D4's "everything unmade" rule, the
/// exact reason this dialog exists rather than a caller assuming auto-fill
/// only ever touches its own prior output. It also states that already-made
/// meals (`madeAt != null`) are always kept, since `overwrite: true` never
/// deletes those rows regardless (§16.2.7).
///
/// Returns `true` only if the user affirmatively tapped "Replace". Cancel —
/// and dismissing the barrier — both resolve to `false` and call nothing,
/// same `showDialog<bool>() ?? false` shape as `showDeleteRecipeDialog`.
Future<bool> showRegenerateConfirmDialog({
  required BuildContext context,
  required int unmadeItemCount,
}) async {
  final bool? confirmed = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) =>
        RegenerateConfirmDialog(unmadeItemCount: unmadeItemCount),
  );
  return confirmed ?? false;
}

class RegenerateConfirmDialog extends StatelessWidget {
  const RegenerateConfirmDialog({super.key, required this.unmadeItemCount});

  final int unmadeItemCount;

  static const Key cancelButtonKey = Key('regenerate-confirm-cancel');
  static const Key confirmButtonKey = Key('regenerate-confirm-confirm');

  @override
  Widget build(BuildContext context) {
    final String itemWord = unmadeItemCount == 1 ? 'item' : 'items';
    return Dialog(
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(borderRadius: AppRadius.borderL),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s3),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              'Replace $unmadeItemCount planned $itemWord?',
              style: AppTypography.title.copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              "Accepting this auto-fill replaces every meal on this week's "
              "plan that hasn't been made yet — including ones you picked "
              'yourself, not just earlier auto-fill picks. Meals already '
              'marked made are always kept.',
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
                    label: 'Replace',
                    variant: PButtonVariant.destructive,
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
}
