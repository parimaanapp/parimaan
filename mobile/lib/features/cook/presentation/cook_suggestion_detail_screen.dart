import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../recipes/domain/ai_recipe_draft_ingredient.dart';
import '../domain/cook_suggestion.dart';

/// Flow 11, frame 11.3 (W21 S5/S6): one suggested recipe, in full — the
/// ingredients marked against the real pantry, never a tappable link (D11:
/// model text is untrusted, rendered as plain data only).
///
/// **"＋ Add to plan" is deliberately absent** (D8): planning from a
/// suggestion needs a day/meal/slot chooser this slice doesn't build. Save
/// is promoted to the primary action; [onSave] is `null` until the router
/// wires it (S6), which the button shows honestly rather than as a dead
/// tap — the same nullable-callback, "Coming soon" convention
/// `AddMethodScreen`'s photo option used before its own flow existed.
class CookSuggestionDetailScreen extends StatefulWidget {
  const CookSuggestionDetailScreen({
    super.key,
    required this.suggestion,
    this.onSave,
    this.onBack,
  });

  final CookSuggestion suggestion;

  /// Opens the save flow (S6's `SaveSuggestionSheet`) and resolves to the
  /// newly created recipe's id, or `null` if the user cancelled, chose
  /// "Edit before saving" instead, or the save failed. A non-null result
  /// flips this screen to "Saved ✓" for the rest of this screen's life —
  /// there is no un-saving from here.
  final Future<String?> Function()? onSave;
  final VoidCallback? onBack;

  static const Key saveButtonKey = Key('cook-detail-save');

  @override
  State<CookSuggestionDetailScreen> createState() =>
      _CookSuggestionDetailScreenState();
}

class _CookSuggestionDetailScreenState
    extends State<CookSuggestionDetailScreen> {
  bool _saving = false;
  bool _saved = false;

  String get _summary {
    final draft = widget.suggestion.draft;
    final parts = <String>[
      if (draft.servings != null) 'For ${draft.servings}',
      if (draft.cookMin != null) '${draft.cookMin} min',
      ...draft.dietaryTags,
    ];
    return parts.join(' · ');
  }

  Future<void> _save() async {
    final onSave = widget.onSave;
    if (_saving || _saved || onSave == null) {
      return;
    }
    setState(() => _saving = true);
    final String? recipeId = await onSave();
    if (!mounted) {
      return;
    }
    setState(() {
      _saving = false;
      _saved = recipeId != null;
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: widget.suggestion.draft.title ?? 'Recipe',
            onBack: widget.onBack ?? () => Navigator.of(context).pop(),
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
                  for (
                    int i = 0;
                    i < widget.suggestion.draft.ingredients.length;
                    i++
                  )
                    _IngredientRow(
                      ingredient: widget.suggestion.draft.ingredients[i],
                      match: i < widget.suggestion.ingredientMatches.length
                          ? widget.suggestion.ingredientMatches[i]
                          : null,
                    ),
                  if (widget.suggestion.draft.warnings.isNotEmpty) ...<Widget>[
                    const SizedBox(height: AppSpacing.s2),
                    for (final String warning
                        in widget.suggestion.draft.warnings)
                      Text(
                        warning,
                        style: AppTypography.meta.copyWith(
                          color: AppColors.terracottaDeep,
                        ),
                      ),
                  ],
                  const SizedBox(height: AppSpacing.s4),
                  if (_saved)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Saved ✓',
                        style: AppTypography.bodyStrong.copyWith(
                          color: AppColors.cardamom,
                        ),
                      ),
                    )
                  else
                    Semantics(
                      key: CookSuggestionDetailScreen.saveButtonKey,
                      button: true,
                      enabled: widget.onSave != null,
                      label: widget.onSave != null
                          ? 'Save'
                          : 'Save — Coming soon',
                      child: ExcludeSemantics(
                        child: Opacity(
                          opacity: widget.onSave != null ? 1 : 0.5,
                          child: PButton(
                            label: 'Save',
                            variant: PButtonVariant.affirmative,
                            expand: true,
                            isLoading: _saving,
                            onPressed: widget.onSave == null ? null : _save,
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
