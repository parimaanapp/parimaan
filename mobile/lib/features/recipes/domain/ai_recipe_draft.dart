import 'ai_recipe_draft_ingredient.dart';
import 'recipe_role.dart';

/// An unsaved, unpersisted recipe proposal returned by
/// `Mutation.parseFreeformRecipe` (W7 S3) or `Mutation.importRecipeFromUrl`
/// (W7 S5) — the client-side mirror of the GraphQL `RecipeDraft` type
/// (E2E_MVP_PLAN.md §13.2.3, D1).
///
/// Deliberately NOT named `RecipeDraft`: that name already belongs to
/// `recipe_draft.dart`'s own client-authored create/edit-form model (W6
/// S8, mirrors `RecipeInput`) — a different concept (in-progress form
/// state the user is typing) that predates W7 by a week and stays
/// untouched. The `Ai` prefix reflects this type's actual origin — a
/// model or a third-party page, never this app's own form — not a
/// judgement about the other type.
///
/// Has no `id`/`householdId`/timestamps, so it can never be mistaken for a
/// persisted recipe. Nothing is written to the database until the user
/// reviews it (S9/S10's job): a confirmed field becomes part of a real
/// [RecipeDraft] (the W6 form shape) submitted via `Mutation.createRecipe`
/// with a `source` attribution (W7 S6).
class AiRecipeDraft {
  const AiRecipeDraft({
    this.title,
    this.description,
    this.servings,
    this.prepMin,
    this.cookMin,
    this.cuisineTier1,
    this.cuisineTier2,
    this.dietaryTags = const <String>[],
    this.role,
    this.ingredients = const <AiRecipeDraftIngredient>[],
    this.steps = const <String>[],
    this.sourceUrl,
    this.warnings = const <String>[],
  });

  final String? title;
  final String? description;
  final int? servings;
  final int? prepMin;
  final int? cookMin;

  /// Raw `CuisineTier1` wire value, or `null` — same "stays a string"
  /// choice as [Recipe.cuisineTier1] (`recipe.dart`).
  final String? cuisineTier1;
  final String? cuisineTier2;

  /// Raw `DietaryTag` wire values.
  final List<String> dietaryTags;

  /// NULLABLE and unconfirmed (§13.2.6 D5) — an AI-proposed role does not
  /// by itself satisfy W6 D1's "role assignment required"; the user must
  /// still affirmatively confirm or change it (`AiRecipeDraftController`'s
  /// own job, via [ProposedField.hasProposal]) before it can become a real
  /// [RecipeDraft.role].
  final RecipeRole? role;
  final List<AiRecipeDraftIngredient> ingredients;
  final List<String> steps;

  /// Set by `importRecipeFromUrl`; always `null` for `parseFreeformRecipe`.
  final String? sourceUrl;

  /// Human-readable, non-blocking notes about what the parser or model
  /// could not determine or had to discard (e.g. an unrecognised cuisine
  /// value, dropped rather than failing the whole parse) — never an error
  /// channel; a draft with warnings is still a usable draft.
  final List<String> warnings;
}
