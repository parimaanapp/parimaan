import 'recipe_ingredient_draft.dart';
import 'recipe_role.dart';

/// The client-authored shape of a new recipe — mirrors `RecipeInput` on the
/// wire (W6 S8). `role` is required with no default: the form's own submit
/// button stays disabled until one is chosen (this is the "role assignment
/// required" DoD gate's actual point of enforcement on the client side,
/// E2E_MVP_PLAN.md §12.7 D1 — the server enforces it independently via the
/// SDL's non-null `RecipeInput.role`). `sourceType`/`sourceUrl` have no
/// field here, matching the SDL: a recipe created through this form is
/// always `sourceType: user`, set server-side, never client-supplied.
class RecipeDraft {
  const RecipeDraft({
    required this.title,
    this.description,
    this.servings,
    this.prepMin,
    this.cookMin,
    this.cuisineTier1,
    this.cuisineTier2,
    this.dietaryTags = const <String>[],
    required this.role,
    this.inRotation,
    this.ingredients = const <RecipeIngredientDraft>[],
    this.steps = const <String>[],
  });

  final String title;
  final String? description;
  final int? servings;
  final int? prepMin;
  final int? cookMin;

  /// Raw `CuisineTier1` wire value, or `null` — same "stays a string" choice
  /// as [Recipe.cuisineTier1], now genuinely editable here (unlike the
  /// read-only Library/Detail screens).
  final String? cuisineTier1;
  final String? cuisineTier2;

  /// Raw `DietaryTag` wire values.
  final List<String> dietaryTags;
  final RecipeRole role;
  final bool? inRotation;
  final List<RecipeIngredientDraft> ingredients;
  final List<String> steps;
}
