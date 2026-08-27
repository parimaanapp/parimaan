import 'recipe_ingredient_draft.dart';
import 'recipe_role.dart';

/// A partial patch for `Mutation.updateRecipe`, mirroring `RecipePatchInput`.
/// Every scalar field is `null`-means-absent, the same convention as
/// [PantryItemPatch] — the server rejects an explicit `null` for those, so
/// there is no third state to express. `ingredients`/`steps` are a
/// deliberately different, third semantic (E2E_MVP_PLAN.md §12.2.4): `null`
/// here means "leave the existing list untouched", and any non-null value
/// — including `const <...>[]` — means "replace the whole list with this
/// one". A form that lets the user delete every ingredient must therefore
/// send `ingredients: const []`, not `null`, to make that stick; `null`
/// would silently leave the old ingredients in place.
class RecipePatch {
  /// A patch with any subset of fields.
  ///
  /// The assert mirrors the server's own `.refine(...)` — a patch with
  /// every field absent is rejected as `VALIDATION`, and there is nothing a
  /// caller could have meant by it, same reasoning as `PantryItemPatch`.
  const RecipePatch({
    this.title,
    this.description,
    this.servings,
    this.prepMin,
    this.cookMin,
    this.cuisineTier1,
    this.cuisineTier2,
    this.dietaryTags,
    this.role,
    this.inRotation,
    this.ingredients,
    this.steps,
  }) : assert(
         title != null ||
             description != null ||
             servings != null ||
             prepMin != null ||
             cookMin != null ||
             cuisineTier1 != null ||
             cuisineTier2 != null ||
             dietaryTags != null ||
             role != null ||
             inRotation != null ||
             ingredients != null ||
             steps != null,
         'A patch must contain at least one field — the server rejects an '
         'all-absent input as VALIDATION.',
       );

  final String? title;
  final String? description;
  final int? servings;
  final int? prepMin;
  final int? cookMin;
  final String? cuisineTier1;
  final String? cuisineTier2;
  final List<String>? dietaryTags;
  final RecipeRole? role;
  final bool? inRotation;

  /// `null` = unchanged; any list (including empty) = replace. See this
  /// class's own doc.
  final List<RecipeIngredientDraft>? ingredients;

  /// Same `null` = unchanged / any list = replace semantic as [ingredients].
  final List<String>? steps;
}
