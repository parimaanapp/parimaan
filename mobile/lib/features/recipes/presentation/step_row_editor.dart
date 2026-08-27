import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// One editable step row in `RecipeFormScreen`'s dynamic-length list (W6
/// S8) — same stateless-by-contract, screen-owns-the-controller, and
/// index-vs-key separation as `IngredientRowEditor`, for the identical
/// reasons documented on that class.
class StepRowEditor extends StatelessWidget {
  const StepRowEditor({
    super.key,
    required this.index,
    required this.controller,
    required this.onRemove,
    required this.enabled,
  });

  final int index;
  final TextEditingController controller;
  final VoidCallback onRemove;
  final bool enabled;

  static Key textFieldKey(int index) => Key('step-row-text-$index');
  static Key removeButtonKey(int index) => Key('step-row-remove-$index');

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s1),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(top: AppSpacing.s2),
          child: Text(
            '${index + 1}.',
            style: AppTypography.label.copyWith(color: AppColors.inkMid),
          ),
        ),
        const SizedBox(width: AppSpacing.s1),
        Expanded(
          child: PInput(
            key: textFieldKey(index),
            label: 'Step ${index + 1}',
            controller: controller,
            enabled: enabled,
            minLines: 1,
            maxLines: 3,
          ),
        ),
        ReorderableDragStartListener(
          index: index,
          child: Padding(
            padding: const EdgeInsets.only(
              top: AppSpacing.s2,
              left: AppSpacing.s1,
            ),
            child: Semantics(
              label: 'Reorder step',
              child: Icon(
                Icons.drag_handle,
                color: AppColors.inkMid,
                size: AppSizing.icon16,
              ),
            ),
          ),
        ),
        PIconButton(
          key: removeButtonKey(index),
          icon: Icons.delete_outline,
          semanticLabel: 'Remove step',
          variant: PButtonVariant.ghost,
          onPressed: enabled ? onRemove : null,
        ),
      ],
    ),
  );
}
