import '../../recipes/domain/recipe_ingredient.dart';

/// Which of [terms] appear as a case-insensitive substring of any of
/// [ingredients]' own names — the client-side mirror of the server's
/// allergen-warning/skip-ingredient matching (`ILIKE '%term%'`,
/// `findInRotationRecipesForAutoFill`'s own doc), used at PICK TIME on one
/// recipe's own ingredients, never as a list-time filter (W10 §16.2.4).
/// An empty or blank term never matches anything (an empty substring would
/// otherwise match every ingredient).
///
/// Returns the ORIGINAL term strings (not lowercased), in [terms]' own
/// order, for direct display — not a boolean per term.
List<String> matchedIngredientWarningTerms(
  List<RecipeIngredient> ingredients,
  List<String> terms,
) {
  final List<String> matches = <String>[];
  for (final String term in terms) {
    final String lowerTerm = term.trim().toLowerCase();
    if (lowerTerm.isEmpty) {
      continue;
    }
    final bool anyIngredientMatches = ingredients.any(
      (RecipeIngredient ingredient) =>
          ingredient.name.toLowerCase().contains(lowerTerm),
    );
    if (anyIngredientMatches) {
      matches.add(term);
    }
  }
  return matches;
}
