import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/radius.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../state/household_settings_controller.dart';
import '../household_error_copy.dart';

/// The type-the-name confirmation for `Mutation.deleteHousehold`.
///
/// ## The exact-match rule is the whole point, and nothing here may soften it
///
/// `api/src/resolvers/deleteHousehold.ts` compares `confirmationName` against
/// the stored name with `!==`: **case-sensitive, no trimming, no
/// normalisation**. This dialog mirrors that comparison byte-for-byte to decide
/// whether to enable its button, and then sends the user's raw string
/// untouched.
///
/// It would be easy, and wrong, to "help" here by trimming or case-folding
/// before comparing. Two distinct failures follow from that, and the second is
/// unacceptable:
///
///  1. A lenient client enables the button for input the server will reject,
///     turning a clear "that is not the name" into a confusing round-trip
///     `VALIDATION` error.
///  2. Worse — a lenient client tells the user *"yes, that matches"* about a
///     string that is not the household's name. For an irreversible delete,
///     showing a green light on a near-miss is the single most dangerous thing
///     this dialog could do.
///
/// So the comparison is `typed == household.name`, exactly, and
/// [HouseholdSettingsController.deleteHousehold] forwards the same string with
/// no processing at all.
///
/// Returns `true` only if the household was actually deleted.
Future<bool> showDeleteHouseholdDialog({
  required BuildContext context,
  required String householdId,
  required String householdName,
}) async {
  final bool? deleted = await showDialog<bool>(
    context: context,
    // The user must resolve this one way or the other — a stray tap outside a
    // half-typed irreversible confirmation should not dismiss it silently.
    barrierDismissible: false,
    builder: (BuildContext context) => _DeleteHouseholdDialog(
      householdId: householdId,
      householdName: householdName,
    ),
  );
  return deleted ?? false;
}

class _DeleteHouseholdDialog extends ConsumerStatefulWidget {
  const _DeleteHouseholdDialog({
    required this.householdId,
    required this.householdName,
  });

  final String householdId;
  final String householdName;

  @override
  ConsumerState<_DeleteHouseholdDialog> createState() =>
      _DeleteHouseholdDialogState();
}

class _DeleteHouseholdDialogState
    extends ConsumerState<_DeleteHouseholdDialog> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    final bool ok = await ref
        .read(householdSettingsControllerProvider.notifier)
        .deleteHousehold(
          widget.householdId,
          // Raw. Not trimmed, not case-folded. See the library doc.
          _controller.text,
        );

    if (!mounted) {
      return;
    }
    if (ok) {
      Navigator.of(context).pop(true);
    }
    // A failure keeps the dialog open with the server's message visible — the
    // household still exists, and dismissing would imply otherwise.
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> settings = ref.watch(
      householdSettingsControllerProvider,
    );
    final bool isBusy =
        settings.isLoading &&
        ref.read(householdSettingsControllerProvider.notifier).action ==
            HouseholdSettingsAction.delete;
    final String? error = householdErrorMessage(settings.error);

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
              DeleteHouseholdDialogKeys.heading,
              style: AppTypography.title.copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(
              'This deletes the household, its settings and everyone’s '
              'membership. It cannot be undone.',
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
            const SizedBox(height: AppSpacing.s2),
            Text(
              'Type ${widget.householdName} to confirm.',
              key: DeleteHouseholdDialogKeys.promptKey,
              style: AppTypography.label.copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.s1),
            PInput(
              key: DeleteHouseholdDialogKeys.inputKey,
              label: 'Household name',
              controller: _controller,
              enabled: !isBusy,
              autofocus: true,
              onChanged: (String _) => setState(() {}),
            ),
            if (error != null) ...<Widget>[
              const SizedBox(height: AppSpacing.s1),
              Text(
                error,
                key: DeleteHouseholdDialogKeys.errorKey,
                style: AppTypography.label.copyWith(color: AppColors.danger),
              ),
            ],
            const SizedBox(height: AppSpacing.s3),
            PButton(
              key: DeleteHouseholdDialogKeys.confirmKey,
              label: 'Delete household',
              variant: PButtonVariant.destructive,
              expand: true,
              isLoading: isBusy,
              // Byte-for-byte equality. See the library doc for why this must
              // not be made lenient.
              onPressed: _controller.text == widget.householdName && !isBusy
                  ? _delete
                  : null,
            ),
            const SizedBox(height: AppSpacing.s1),
            PButton(
              key: DeleteHouseholdDialogKeys.cancelKey,
              label: 'Cancel',
              variant: PButtonVariant.ghost,
              expand: true,
              onPressed: isBusy ? null : () => Navigator.of(context).pop(false),
            ),
          ],
        ),
      ),
    );
  }
}

/// Widget keys and copy, exposed for tests.
///
/// A separate holder because the dialog itself is private — the only supported
/// entry point is [showDeleteHouseholdDialog], so that the barrier and
/// return-value contract cannot be bypassed by constructing the widget
/// directly.
abstract final class DeleteHouseholdDialogKeys {
  static const String heading = 'Delete this household?';

  static const Key promptKey = Key('delete-household-prompt');
  static const Key inputKey = Key('delete-household-input');
  static const Key confirmKey = Key('delete-household-confirm');
  static const Key cancelKey = Key('delete-household-cancel');
  static const Key errorKey = Key('delete-household-error');
}
