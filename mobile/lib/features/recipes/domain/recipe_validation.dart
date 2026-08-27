/// Fast client-side feedback mirroring `api/src/validation/recipeShared.ts`
/// (and `createRecipe.ts`/`updateRecipe.ts`, whose per-field bounds are
/// identical) — same "this is not a gate, the server remains the
/// authority" rule as `pantry_item_validation.dart`. Bounds and messages
/// are hand-ported, not shared, from the Zod schemas; drift is caught by
/// this file's own tests mirroring the server's Vitest case table, not by
/// any shared code.
library;

const int maxRecipeTitleLength = 200;
const int maxRecipeDescriptionLength = 2000;
const int maxRecipeCuisineTier2Length = 60;
const int maxRecipeIngredientNameLength = 120;
const int maxRecipeIngredientUnitLength = 20;
const int maxRecipeIngredientCategoryLength = 40;
const int maxRecipeIngredientNotesLength = 500;
const int maxRecipeStepLength = 2000;

/// Zero entries is valid (a recipe with no ingredients listed, or no steps
/// written yet, is a real state — same `MAX_INGREDIENTS`/`MAX_STEPS` doc as
/// the server's), so these bound only the *upper* end.
const int maxRecipeIngredients = 100;
const int maxRecipeSteps = 100;

String? validateRecipeTitle(String title) {
  final String trimmed = title.trim();
  if (trimmed.isEmpty) {
    return 'title must not be empty';
  }
  if (trimmed.length > maxRecipeTitleLength) {
    return 'title must be at most $maxRecipeTitleLength characters';
  }
  return null;
}

/// `null`/empty means "not set", not a validation failure.
String? validateRecipeDescription(String? description) {
  if (description == null) {
    return null;
  }
  final String trimmed = description.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.length > maxRecipeDescriptionLength) {
    return 'description must be at most $maxRecipeDescriptionLength characters';
  }
  return null;
}

String? validateRecipeCuisineTier2(String? cuisineTier2) {
  if (cuisineTier2 == null) {
    return null;
  }
  final String trimmed = cuisineTier2.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.length > maxRecipeCuisineTier2Length) {
    return 'cuisineTier2 must be at most $maxRecipeCuisineTier2Length characters';
  }
  return null;
}

String? validateRecipeServings(int? servings) {
  if (servings == null) {
    return null;
  }
  if (servings < 1) {
    return 'servings must be at least 1';
  }
  return null;
}

String? validateRecipeMinutes(int? minutes, String fieldName) {
  if (minutes == null) {
    return null;
  }
  if (minutes < 0) {
    return '$fieldName must not be negative';
  }
  return null;
}

String? validateRecipeIngredientName(String name) {
  final String trimmed = name.trim();
  if (trimmed.isEmpty) {
    return 'ingredient name must not be empty';
  }
  if (trimmed.length > maxRecipeIngredientNameLength) {
    return 'ingredient name must be at most $maxRecipeIngredientNameLength characters';
  }
  return null;
}

String? validateRecipeIngredientQuantity(double? quantity) {
  if (quantity == null) {
    return null;
  }
  if (quantity.isNaN) {
    return 'ingredient quantity must be a number';
  }
  if (quantity < 0) {
    return 'ingredient quantity must not be negative';
  }
  return null;
}

String? validateRecipeIngredientUnit(String? unit) {
  if (unit == null) {
    return null;
  }
  final String trimmed = unit.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.length > maxRecipeIngredientUnitLength) {
    return 'ingredient unit must be at most $maxRecipeIngredientUnitLength characters';
  }
  return null;
}

String? validateRecipeIngredientCategory(String? category) {
  if (category == null) {
    return null;
  }
  final String trimmed = category.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.length > maxRecipeIngredientCategoryLength) {
    return 'ingredient category must be at most $maxRecipeIngredientCategoryLength characters';
  }
  return null;
}

String? validateRecipeIngredientNotes(String? notes) {
  if (notes == null) {
    return null;
  }
  final String trimmed = notes.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.length > maxRecipeIngredientNotesLength) {
    return 'ingredient notes must be at most $maxRecipeIngredientNotesLength characters';
  }
  return null;
}

String? validateRecipeStep(String step) {
  final String trimmed = step.trim();
  if (trimmed.length > maxRecipeStepLength) {
    return 'each step must be at most $maxRecipeStepLength characters';
  }
  return null;
}
