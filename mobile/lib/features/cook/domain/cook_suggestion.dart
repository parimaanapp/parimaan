import 'package:flutter/foundation.dart';

import '../../recipes/domain/ai_recipe_draft.dart';
import 'cook_vibe.dart';

/// Whether one suggested ingredient is in the household's pantry. Presence,
/// never quantity: "in pantry" means some is on hand, not that there is enough.
enum PantryMatchStatus { inPantry, missing, assumed }

/// One suggested ingredient's place in the pantry (W21).
@immutable
class CookIngredientMatch {
  const CookIngredientMatch({
    required this.ingredient,
    required this.status,
    this.pantryItemName,
  }) : assert(
         (status == PantryMatchStatus.inPantry) == (pantryItemName != null),
         'A pantry name is present if and only if the ingredient is in the pantry.',
       );

  /// The recipe's own wording for this ingredient.
  final String ingredient;
  final PantryMatchStatus status;

  /// The matched pantry row's own stored name. Never the model's text.
  final String? pantryItemName;

  @override
  bool operator ==(Object other) =>
      other is CookIngredientMatch &&
      other.ingredient == ingredient &&
      other.status == status &&
      other.pantryItemName == pantryItemName;

  @override
  int get hashCode => Object.hash(ingredient, status, pantryItemName);
}

/// One suggested recipe (W21). Unsaved: it has an [id] of its own for keying UI
/// state (an expanded card, a "saved" marker), never the id of a recipe.
@immutable
class CookSuggestion {
  CookSuggestion({
    required this.id,
    required this.draft,
    required List<CookIngredientMatch> ingredientMatches,
    required List<String> have,
    required List<String> missing,
  }) : ingredientMatches = List<CookIngredientMatch>.unmodifiable(
         ingredientMatches,
       ),
       have = List<String>.unmodifiable(have),
       missing = List<String>.unmodifiable(missing);

  /// Stable across a cached answer for the same pantry, vibe and rules.
  final String id;

  /// The proposed recipe. `role` is an AI proposal, never a confirmed role.
  final AiRecipeDraft draft;

  /// One entry per `draft.ingredients` element, in the same order.
  final List<CookIngredientMatch> ingredientMatches;

  /// Distinct pantry-row names this recipe uses.
  final List<String> have;

  /// The recipe's own wording for each ingredient the pantry lacks.
  final List<String> missing;

  @override
  bool operator ==(Object other) =>
      other is CookSuggestion &&
      other.id == id &&
      listEquals(other.ingredientMatches, ingredientMatches) &&
      listEquals(other.have, have) &&
      listEquals(other.missing, missing) &&
      other.draft.title == draft.title;

  @override
  int get hashCode => Object.hash(
    id,
    Object.hashAll(have),
    Object.hashAll(missing),
    draft.title,
  );
}

/// What the server found. `pantryTooSmall` and `noGroundedSuggestions` are
/// normal answers with their own screens, not errors.
enum CookOutcome { suggestions, pantryTooSmall, noGroundedSuggestions }

@immutable
class CookFromPantryResult {
  CookFromPantryResult({
    required this.outcome,
    this.vibe,
    List<CookSuggestion> suggestions = const <CookSuggestion>[],
  }) : suggestions = List<CookSuggestion>.unmodifiable(suggestions),
       assert(
         (outcome == CookOutcome.suggestions) == suggestions.isNotEmpty,
         'Suggestions are present if and only if the outcome is suggestions.',
       );

  final CookOutcome outcome;

  /// The vibe this answer is for (null: any vibe).
  final CookVibe? vibe;
  final List<CookSuggestion> suggestions;

  @override
  bool operator ==(Object other) =>
      other is CookFromPantryResult &&
      other.outcome == outcome &&
      other.vibe == vibe &&
      listEquals(other.suggestions, suggestions);

  @override
  int get hashCode => Object.hash(outcome, vibe, Object.hashAll(suggestions));
}
