import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../recipes/data/recipe_repository.dart';
import '../../recipes/domain/ai_recipe_draft_ingredient.dart';
import '../../recipes/domain/proposed_field.dart';
import '../../recipes/domain/recipe_draft.dart';
import '../../recipes/domain/recipe_ingredient_draft.dart';
import '../../recipes/domain/recipe_role.dart';
import '../../recipes/domain/recipe_source.dart';
import '../../recipes/domain/recipe_source_attribution.dart';
import '../../recipes/presentation/ai_proposal.dart';
import '../../recipes/presentation/recipes_error_copy.dart';
import '../../recipes/state/recipe_library_controller.dart';
import '../domain/cook_suggestion.dart';

/// Flow 11 (W21 S6, D9): saving a suggestion as-is. Opened from
/// [CookSuggestionDetailScreen]'s Save action.
///
/// Mirrors `RecipeFormScreen`'s own review-mode role rule exactly (§12.7
/// D1/§13.2.6 D5, carried unchanged into D9): a recipe can never save with
/// a role nobody actively chose, so the AI's proposed role starts
/// unconfirmed — tapping the SAME chip again confirms it, tapping a
/// DIFFERENT one changes it, and Save stays disabled until one or the
/// other happens. Everything else about the draft goes through unedited;
/// "Edit before saving" is the way to touch anything else.
///
/// Returns the newly created recipe's id on a successful save, or `null` if
/// the sheet was dismissed or the user chose "Edit before saving" instead.
Future<String?> showSaveSuggestionSheet(
  BuildContext context, {
  required String householdId,
  required CookSuggestion suggestion,
  required VoidCallback onEditBeforeSaving,
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  backgroundColor: AppColors.paper,
  builder: (BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: SaveSuggestionSheet(
      householdId: householdId,
      suggestion: suggestion,
      onEditBeforeSaving: onEditBeforeSaving,
    ),
  ),
);

class SaveSuggestionSheet extends ConsumerStatefulWidget {
  const SaveSuggestionSheet({
    super.key,
    required this.householdId,
    required this.suggestion,
    required this.onEditBeforeSaving,
  });

  final String householdId;
  final CookSuggestion suggestion;
  final VoidCallback onEditBeforeSaving;

  static const Key saveButtonKey = Key('save-suggestion-save');
  static const Key editBeforeSavingKey = Key('save-suggestion-edit');
  static Key roleChipKey(RecipeRole role) =>
      Key('save-suggestion-role-${role.name}');

  @override
  ConsumerState<SaveSuggestionSheet> createState() =>
      _SaveSuggestionSheetState();
}

class _SaveSuggestionSheetState extends ConsumerState<SaveSuggestionSheet> {
  late ProposedField<RecipeRole> _role = widget.suggestion.draft.role == null
      ? const ProposedField<RecipeRole>.empty()
      : ProposedField<RecipeRole>.proposed(widget.suggestion.draft.role);
  bool _saving = false;
  String? _error;

  bool get _confirmed => _role.value != null && !_role.isProposed;

  void _onRoleTap(RecipeRole role) {
    setState(() {
      _role = _role.isProposed && _role.value == role
          ? _role.accept()
          : _role.edit(role);
    });
  }

  RecipeIngredientDraft _toIngredientDraft(AiRecipeDraftIngredient i) =>
      RecipeIngredientDraft(
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        notes: i.notes,
      );

  Future<void> _save() async {
    if (_saving || !_confirmed) {
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final draft = widget.suggestion.draft;
    try {
      final recipe = await ref
          .read(recipeRepositoryProvider)
          .createRecipe(
            widget.householdId,
            RecipeDraft(
              title: draft.title ?? '',
              description: draft.description,
              servings: draft.servings,
              prepMin: draft.prepMin,
              cookMin: draft.cookMin,
              cuisineTier1: draft.cuisineTier1,
              cuisineTier2: draft.cuisineTier2,
              dietaryTags: draft.dietaryTags,
              role: _role.value!,
              inRotation: true,
              ingredients: draft.ingredients
                  .map(_toIngredientDraft)
                  .toList(growable: false),
              steps: draft.steps,
            ),
            source: const RecipeSourceAttribution(sourceType: RecipeSource.ai),
          );
      if (!mounted) {
        return;
      }
      ref.invalidate(recipeLibraryControllerProvider(widget.householdId));
      Navigator.of(context).pop(recipe.id);
    } on Object catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _error =
            recipeErrorMessage(error) ??
            "Couldn't save this just now. Try again.";
      });
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text('Save this recipe?', style: AppTypography.displayM),
          const SizedBox(height: AppSpacing.s0),
          Text(
            "It'll join your rotation, and appear in your recipe library.",
            style: AppTypography.body.copyWith(color: AppColors.inkMid),
          ),
          const SizedBox(height: AppSpacing.s3),
          Text(
            'ROLE',
            style: AppTypography.meta.copyWith(color: AppColors.inkMid),
          ),
          const SizedBox(height: AppSpacing.s1),
          AIProposal<RecipeRole>(
            field: _role,
            // `onChanged` is a no-op and the builder below never calls its own
            // `onEdit`/`onAccept`/`onReject` — `_onRoleTap` drives the
            // accept/edit transition directly via `setState`, same as
            // `RecipeFormScreen`'s `_proposalWrap` does for this exact widget.
            // Intentional, not a missed wiring: don't "fix" this by also
            // calling the builder callbacks, which would double-apply the
            // transition.
            onChanged: (_) {},
            semanticsLabel: 'AI-suggested role, not yet confirmed',
            builder: (context, field, onEdit, onAccept, onReject) => Wrap(
              spacing: AppSpacing.s1,
              runSpacing: AppSpacing.s1,
              children: <Widget>[
                for (final role in RecipeRole.selectable)
                  PChip(
                    key: SaveSuggestionSheet.roleChipKey(role),
                    label: role.displayLabel,
                    // Same rule as `RecipeFormScreen`'s review mode: a still-unconfirmed
                    // proposal must never render as `selected` — that look is
                    // indistinguishable from an actually-confirmed choice.
                    selected: _role.value == role && !_role.isProposed,
                    onTap: _saving ? null : () => _onRoleTap(role),
                  ),
              ],
            ),
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: AppSpacing.s2),
            Text(
              _error!,
              style: AppTypography.body.copyWith(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: AppSpacing.s3),
          Row(
            children: <Widget>[
              Expanded(
                child: PButton(
                  key: SaveSuggestionSheet.editBeforeSavingKey,
                  label: 'Edit before saving',
                  variant: PButtonVariant.secondary,
                  onPressed: _saving
                      ? null
                      : () {
                          Navigator.of(context).pop();
                          widget.onEditBeforeSaving();
                        },
                ),
              ),
              const SizedBox(width: AppSpacing.s2),
              Expanded(
                child: PButton(
                  key: SaveSuggestionSheet.saveButtonKey,
                  label: 'Save',
                  variant: PButtonVariant.affirmative,
                  isLoading: _saving,
                  onPressed: _confirmed && !_saving ? _save : null,
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
