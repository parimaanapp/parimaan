import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// Warns (never blocks) at the moment a recipe is picked that it matches
/// one or more of the household's own allergen and/or skip-ingredient
/// terms — PRD §7.1's allergen warning, and W10 D7's choice to mark rather
/// than hide a skip-listed recipe in the picker specifically (unlike
/// `autoFillWeek`, which hard-filters both; there is no human in that loop
/// to see this warning). Returns `true` only if the caller proceeds
/// anyway; `false` (including the barrier-dismiss case) means stay on the
/// picker.
Future<bool> showIngredientWarningDialog({
  required BuildContext context,
  required List<String> allergenMatches,
  required List<String> skipMatches,
}) async {
  final bool? proceed = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => IngredientWarningDialog(
      allergenMatches: allergenMatches,
      skipMatches: skipMatches,
    ),
  );
  return proceed ?? false;
}

class IngredientWarningDialog extends StatelessWidget {
  const IngredientWarningDialog({
    super.key,
    required this.allergenMatches,
    required this.skipMatches,
  });

  final List<String> allergenMatches;
  final List<String> skipMatches;

  static const Key cancelButtonKey = Key('ingredient-warning-cancel');
  static const Key proceedButtonKey = Key('ingredient-warning-proceed');

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
            'Check the ingredients',
            style: AppTypography.title.copyWith(color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.s2),
          if (allergenMatches.isNotEmpty)
            Text(
              'Contains: ${allergenMatches.join(', ')} — you flagged this as an allergen.',
              style: AppTypography.label.copyWith(color: AppColors.danger),
            ),
          if (allergenMatches.isNotEmpty && skipMatches.isNotEmpty)
            const SizedBox(height: AppSpacing.s1),
          if (skipMatches.isNotEmpty)
            Text(
              'Contains: ${skipMatches.join(', ')} — on your skip list.',
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
          const SizedBox(height: AppSpacing.s3),
          Row(
            children: <Widget>[
              Expanded(
                child: PButton(
                  key: cancelButtonKey,
                  label: 'Pick something else',
                  variant: PButtonVariant.secondary,
                  onPressed: () => Navigator.of(context).pop(false),
                ),
              ),
              const SizedBox(width: AppSpacing.s2),
              Expanded(
                child: PButton(
                  key: proceedButtonKey,
                  label: 'Add anyway',
                  variant: PButtonVariant.primary,
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
