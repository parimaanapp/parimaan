import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../recipes/domain/ai_recipe_draft_ingredient.dart';
import '../domain/cook_suggestion.dart';

/// Flow 11, frame 11.3 (W21 S5): one suggested recipe, in full — the
/// ingredients marked against the real pantry, never a tappable link (D11:
/// model text is untrusted, rendered as plain data only).
///
/// **"＋ Add to plan" is deliberately absent** (D8): planning from a
/// suggestion needs a day/meal/slot chooser this slice doesn't build. Save
/// is promoted to the primary action; [onSave] is `null` until S6 wires it,
/// which the button shows honestly rather than as a dead tap — the same
/// nullable-callback, "Coming soon" convention `AddMethodScreen`'s photo
/// option used before its own flow existed.
class CookSuggestionDetailScreen extends StatelessWidget {
  const CookSuggestionDetailScreen({
    super.key,
    required this.suggestion,
    this.onSave,
    this.onBack,
  });

  final CookSuggestion suggestion;
  final VoidCallback? onSave;
  final VoidCallback? onBack;

  static const Key saveButtonKey = Key('cook-detail-save');

  String get _summary {
    final parts = <String>[
      if (suggestion.draft.servings != null) 'For ${suggestion.draft.servings}',
      if (suggestion.draft.cookMin != null) '${suggestion.draft.cookMin} min',
      ...suggestion.draft.dietaryTags,
    ];
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: suggestion.draft.title ?? 'Recipe',
            onBack: onBack ?? () => Navigator.of(context).pop(),
            backSemanticLabel: 'Back',
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: PBadge(
                      label: '◆ AI recipe',
                      tone: PBadgeTone.accent,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.s1),
                  if (_summary.isNotEmpty)
                    Text(
                      _summary,
                      style: AppTypography.body.copyWith(
                        color: AppColors.inkMid,
                      ),
                    ),
                  const SizedBox(height: AppSpacing.s3),
                  Text('INGREDIENTS', style: AppTypography.label),
                  const SizedBox(height: AppSpacing.s1),
                  for (int i = 0; i < suggestion.draft.ingredients.length; i++)
                    _IngredientRow(
                      ingredient: suggestion.draft.ingredients[i],
                      match: i < suggestion.ingredientMatches.length
                          ? suggestion.ingredientMatches[i]
                          : null,
                    ),
                  if (suggestion.draft.warnings.isNotEmpty) ...<Widget>[
                    const SizedBox(height: AppSpacing.s2),
                    for (final String warning in suggestion.draft.warnings)
                      Text(
                        warning,
                        style: AppTypography.meta.copyWith(
                          color: AppColors.terracottaDeep,
                        ),
                      ),
                  ],
                  const SizedBox(height: AppSpacing.s4),
                  Semantics(
                    key: saveButtonKey,
                    button: true,
                    enabled: onSave != null,
                    label: onSave != null ? 'Save' : 'Save — Coming soon',
                    child: ExcludeSemantics(
                      child: Opacity(
                        opacity: onSave != null ? 1 : 0.5,
                        child: PButton(
                          label: 'Save',
                          variant: PButtonVariant.affirmative,
                          expand: true,
                          onPressed: onSave,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class _IngredientRow extends StatelessWidget {
  const _IngredientRow({required this.ingredient, required this.match});

  final AiRecipeDraftIngredient ingredient;
  final CookIngredientMatch? match;

  String get _amount {
    final double? q = ingredient.quantity;
    final String? unit = ingredient.unit;
    if (q == null) {
      return ingredient.name;
    }
    final String number = q == q.roundToDouble()
        ? q.toInt().toString()
        : q.toString();
    return '${ingredient.name} · $number${unit == null ? '' : ' $unit'}';
  }

  String get _status => switch (match?.status) {
    PantryMatchStatus.inPantry => '✓ in pantry',
    PantryMatchStatus.assumed => 'assumed at home',
    PantryMatchStatus.missing || null => '— missing',
  };

  Color get _color => switch (match?.status) {
    PantryMatchStatus.inPantry => AppColors.cardamom,
    PantryMatchStatus.assumed => AppColors.inkMid,
    PantryMatchStatus.missing || null => AppColors.danger,
  };

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppSpacing.s0),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Text(
            _amount,
            style: AppTypography.body.copyWith(color: AppColors.ink),
          ),
        ),
        Text(
          _status,
          style: AppTypography.body.copyWith(
            color: _color,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    ),
  );
}
