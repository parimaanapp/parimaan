import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// Warns (never blocks) at the moment a recipe is picked that it matches
/// one or more of the household's own allergen and/or skip-ingredient
/// terms, or doesn't carry one of the household's own dietary tags — PRD
/// §7.1's allergen warning, and W10 D7/D8's choice to mark rather than
/// hide a skip-listed or dietary-tag-mismatched recipe in the picker
/// specifically (unlike `autoFillWeek`, which hard-filters all three;
/// there is no human in that loop to see this warning). Returns `true`
/// only if the caller proceeds anyway; `false` (including the
/// barrier-dismiss case) means stay on the picker.
Future<bool> showIngredientWarningDialog({
  required BuildContext context,
  required List<String> allergenMatches,
  required List<String> skipMatches,
  List<String> dietaryTagMismatches = const <String>[],
}) async {
  final bool? proceed = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => IngredientWarningDialog(
      allergenMatches: allergenMatches,
      skipMatches: skipMatches,
      dietaryTagMismatches: dietaryTagMismatches,
    ),
  );
  return proceed ?? false;
}

class IngredientWarningDialog extends StatelessWidget {
  const IngredientWarningDialog({
    super.key,
    required this.allergenMatches,
    required this.skipMatches,
    this.dietaryTagMismatches = const <String>[],
  });

  final List<String> allergenMatches;
  final List<String> skipMatches;
  final List<String> dietaryTagMismatches;

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
          if ((allergenMatches.isNotEmpty || skipMatches.isNotEmpty) &&
              dietaryTagMismatches.isNotEmpty)
            const SizedBox(height: AppSpacing.s1),
          if (dietaryTagMismatches.isNotEmpty)
            Text(
              "Doesn't match: ${dietaryTagMismatches.map(_humanizeDietaryTag).join(', ')} — your household diet.",
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

/// `veg` → `Veg`, `gluten_free` → `Gluten Free` — the household's raw wire-value
/// dietary tags (`HouseholdSettings.dietaryTags`) have no display-label enum
/// wired up to this read-only picker flow, so this mirrors
/// `confirm_join_screen.dart`'s own local `_humanize` rather than pulling in
/// `DietaryTag` for one string.
String _humanizeDietaryTag(String wireValue) => wireValue
    .split('_')
    .map(
      (String word) =>
          word.isEmpty ? word : word[0].toUpperCase() + word.substring(1),
    )
    .join(' ');
