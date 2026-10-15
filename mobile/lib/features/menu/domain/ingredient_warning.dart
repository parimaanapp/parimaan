import '../../household/domain/diet_match.dart';
import '../../recipes/domain/recipe_ingredient.dart';

/// Which of [terms] appear as a case-insensitive substring of any of
/// [ingredients]' own names — the client-side mirror of the server's
/// allergen-warning/skip-ingredient matching (`ILIKE '%term%'`,
/// `findAutoFillCandidates`'s own doc), used at PICK TIME on one
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

/// Which of [householdDietaryTags] the recipe DOESN'T satisfy — used at PICK
/// TIME to mark (never hide, never block) a recipe the household's diet
/// doesn't match. Same asymmetry as D7: `autoFillWeek` hard-excludes
/// automatically, since there's no human in that loop to see a warning; the
/// picker only ever marks.
///
/// Uses the shared diet matcher (`diet_match.dart`, a port of the API's
/// `dietMatch.ts`), so a veg recipe does not mismatch a [veg, eggetarian] or
/// [non_veg] household. A household with no `dietaryTags` configured always
/// returns an empty list — nothing to warn about.
///
/// Returns the ORIGINAL household tag strings (not the recipe's), in
/// [householdDietaryTags]' own order.
List<String> mismatchedDietaryTags(
  List<String> recipeDietaryTags,
  List<String> householdDietaryTags,
) => unmetHouseholdTags(recipeDietaryTags, householdDietaryTags);

