import 'recipe_ingredient.dart';
import 'recipe_role.dart';
import 'recipe_source.dart';

/// The app's own recipe type, independent of GraphQL and of `built_value` —
/// same boundary rule as `features/household/domain/household.dart` and
/// `features/pantry/domain/pantry_item.dart`. The mapping from the generated
/// types lives in `../data/recipe_mapper.dart`.
///
/// `cuisineTier1`/`dietaryTags` are kept as the server's own raw wire-value
/// strings, not a typed enum — matching `HouseholdSettings`'s identical
/// choice (`features/household/domain/household.dart`) rather than
/// `household_wizard_data.dart`'s typed `CuisineRegion`/`DietaryTag`: this is
/// a *read* model with no chip-editing UI in this slice (only `role` and
/// `isFavorite` are filterable — see `RecipeLibraryController`), so there is
/// nothing that needs the typed enum's exhaustive-switch guarantee yet.
class Recipe {
  const Recipe({
    required this.id,
    required this.householdId,
    required this.sourceType,
    this.sourceUrl,
    required this.title,
    this.description,
    required this.servings,
    this.prepMin,
    this.cookMin,
    this.cuisineTier1,
    this.cuisineTier2,
    required this.dietaryTags,
    required this.role,
    required this.inRotation,
    required this.isFavorite,
    this.ingredients,
    required this.steps,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String householdId;
  final RecipeSource sourceType;
  final String? sourceUrl;
  final String title;
  final String? description;
  final int servings;
  final int? prepMin;
  final int? cookMin;

  /// Raw `CuisineTier1` wire value (e.g. `'north_indian'`), or `null`. See
  /// this class's own doc for why it stays a string.
  final String? cuisineTier1;
  final String? cuisineTier2;

  /// Raw `DietaryTag` wire values. See this class's own doc.
  final List<String> dietaryTags;
  final RecipeRole role;
  final bool inRotation;
  final bool isFavorite;

  /// `null` when not fetched (the Library query never selects it —
  /// E2E_MVP_PLAN.md §12.2.7); a non-null (possibly empty) list once a
  /// Detail-scale query has. Never conflate "not fetched" with "fetched, has
  /// none" — the two are different states with different UI.
  final List<RecipeIngredient>? ingredients;
  final List<String> steps;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// `prepMin + cookMin`, treating an absent one as zero — `null` only when
  /// **both** are absent, so a card with just one of the two still shows a
  /// number instead of hiding it because of the other's silence.
  int? get totalTimeMin {
    final int? prepMin = this.prepMin;
    final int? cookMin = this.cookMin;
    if (prepMin == null && cookMin == null) {
      return null;
    }
    return (prepMin ?? 0) + (cookMin ?? 0);
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Recipe &&
          other.id == id &&
          other.householdId == householdId &&
          other.sourceType == sourceType &&
          other.sourceUrl == sourceUrl &&
          other.title == title &&
          other.description == description &&
          other.servings == servings &&
          other.prepMin == prepMin &&
          other.cookMin == cookMin &&
          other.cuisineTier1 == cuisineTier1 &&
          other.cuisineTier2 == cuisineTier2 &&
          _listEquals(other.dietaryTags, dietaryTags) &&
          other.role == role &&
          other.inRotation == inRotation &&
          other.isFavorite == isFavorite &&
          _nullableIngredientsEqual(other.ingredients, ingredients) &&
          _listEquals(other.steps, steps) &&
          other.createdAt == createdAt &&
          other.updatedAt == updatedAt;

  @override
  int get hashCode => Object.hash(
    id,
    householdId,
    sourceType,
    sourceUrl,
    title,
    description,
    servings,
    prepMin,
    cookMin,
    cuisineTier1,
    cuisineTier2,
    Object.hashAll(dietaryTags),
    role,
    inRotation,
    isFavorite,
    ingredients == null ? null : Object.hashAll(ingredients!),
    Object.hashAll(steps),
    createdAt,
    updatedAt,
  );
}

bool _listEquals(List<String> a, List<String> b) {
  if (a.length != b.length) {
    return false;
  }
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) {
      return false;
    }
  }
  return true;
}

bool _nullableIngredientsEqual(
  List<RecipeIngredient>? a,
  List<RecipeIngredient>? b,
) {
  if (a == null || b == null) {
    return a == b;
  }
  if (a.length != b.length) {
    return false;
  }
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) {
      return false;
    }
  }
  return true;
}
