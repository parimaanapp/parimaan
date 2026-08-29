import 'recipe_source.dart';

/// Provenance to attach to a `Mutation.createRecipe` call when confirming a
/// draft — mirrors `RecipeSourceAttribution` on the wire (W7 S6). Only ever
/// constructed by the freeform/URL review flow (`RecipeFormScreen`'s review
/// mode, W7 S10); every other `createRecipe` call omits `source` entirely,
/// which resolves server-side to `sourceType: user` — the same "absent
/// means user-authored" default every pre-W7 caller already relies on.
class RecipeSourceAttribution {
  const RecipeSourceAttribution({required this.sourceType, this.sourceUrl});

  final RecipeSource sourceType;

  /// Required exactly when [sourceType] is `RecipeSource.url` — enforced
  /// server-side (`api/src/validation/createRecipe.ts`), not re-validated
  /// here.
  final String? sourceUrl;
}
