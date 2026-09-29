import '../../../shared/graphql/__generated__/schema.schema.gql.dart'
    show GCookFromPantryOutcome, GCookVibe, GPantryMatchStatus;
import '../../../shared/graphql/operations/__generated__/cook_from_pantry.data.gql.dart';
import '../../recipes/data/ai_recipe_draft_mapper.dart';
import '../domain/cook_suggestion.dart';
import '../domain/cook_vibe.dart';

/// The write direction, for `Mutation.cookFromPantry`'s `$vibe` argument. `null` means "any vibe".
GCookVibe? cookVibeToGraphQL(CookVibe? vibe) => switch (vibe) {
  null => null,
  CookVibe.quick => GCookVibe.quick,
  CookVibe.weekend => GCookVibe.weekend,
  CookVibe.kidFriendly => GCookVibe.kid_friendly,
  CookVibe.comfort => GCookVibe.comfort,
};

/// `GCookVibe` is a built_value `EnumClass`, not exhaustively checkable — an
/// unrecognised value from a newer server falls to `null` ("any vibe"), the
/// conservative reading, rather than throwing on an echoed value this client
/// merely displays back.
CookVibe? _cookVibeFromGraphQL(GCookVibe? vibe) => switch (vibe) {
  GCookVibe.quick => CookVibe.quick,
  GCookVibe.weekend => CookVibe.weekend,
  GCookVibe.kid_friendly => CookVibe.kidFriendly,
  GCookVibe.comfort => CookVibe.comfort,
  _ => null,
};

/// An unrecognised status maps to `missing`, the conservative reading — an
/// item this client can't confirm the server meant as "in pantry" is never
/// silently shown as one (built_value's `EnumClass` is not exhaustively
/// checkable, same rationale as `_toConfidence` in `pantry_photo_repository.dart`).
PantryMatchStatus _statusFromGraphQL(GPantryMatchStatus status) =>
    switch (status) {
      GPantryMatchStatus.in_pantry => PantryMatchStatus.inPantry,
      GPantryMatchStatus.assumed => PantryMatchStatus.assumed,
      _ => PantryMatchStatus.missing,
    };

CookIngredientMatch _matchFromGraphQL(
  GCookFromPantryData_cookFromPantry_suggestions_ingredientMatches data,
) => CookIngredientMatch(
  ingredient: data.ingredient,
  status: _statusFromGraphQL(data.status),
  pantryItemName: data.pantryItemName,
);

CookSuggestion _suggestionFromGraphQL(
  GCookFromPantryData_cookFromPantry_suggestions data,
) => CookSuggestion(
  id: data.id,
  draft: aiRecipeDraftFromGraphQL(data.draft),
  ingredientMatches: data.ingredientMatches
      .map(_matchFromGraphQL)
      .toList(growable: false),
  have: data.have.toList(growable: false),
  missing: data.missing.toList(growable: false),
);

/// An unrecognised outcome (a future server value this client doesn't know
/// yet) falls to `noGroundedSuggestions` — the safest of the two non-list
/// outcomes to land on, since it never claims the pantry was too small when
/// it might not be, and offers the same "add manually" way forward either way.
CookFromPantryResult cookFromPantryResultFromGraphQL(
  GCookFromPantryData_cookFromPantry data,
) => CookFromPantryResult(
  outcome: switch (data.outcome) {
    GCookFromPantryOutcome.suggestions => CookOutcome.suggestions,
    GCookFromPantryOutcome.pantry_too_small => CookOutcome.pantryTooSmall,
    _ => CookOutcome.noGroundedSuggestions,
  },
  vibe: _cookVibeFromGraphQL(data.vibe),
  suggestions: data.suggestions
      .map(_suggestionFromGraphQL)
      .toList(growable: false),
);
