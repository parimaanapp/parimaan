import '../../../shared/graphql/operations/__generated__/recipe_draft_fields.data.gql.dart';
import '../domain/ai_recipe_draft.dart';
import '../domain/ai_recipe_draft_ingredient.dart';
import 'recipe_mapper.dart' show recipeRoleFromGraphQL;

/// The boundary where Ferry / `built_value` types become the plain domain
/// [AiRecipeDraft] — same rule and precedent as `recipe_mapper.dart`'s own
/// [recipeDetailFromGraphQL]. Takes the **fragment** interface
/// `GRecipeDraftFields`, not either mutation's own generated element type
/// — `ParseFreeformRecipe`/`ImportRecipeFromUrl` both spread
/// `RecipeDraftFields`, so this one mapper serves both operations, the
/// same `RecipeDetailFields`/`PantryItemFields` shape this codebase always
/// uses when more than one operation returns an identical selection.
AiRecipeDraft aiRecipeDraftFromGraphQL(GRecipeDraftFields data) => AiRecipeDraft(
  title: data.title,
  description: data.description,
  servings: data.servings,
  prepMin: data.prepMin,
  cookMin: data.cookMin,
  cuisineTier1: data.cuisineTier1?.name,
  cuisineTier2: data.cuisineTier2,
  dietaryTags: data.dietaryTags.map((dietaryTag) => dietaryTag.name).toList(growable: false),
  role: data.role == null ? null : recipeRoleFromGraphQL(data.role!),
  ingredients: data.ingredients.map(_aiRecipeDraftIngredientFromGraphQL).toList(growable: false),
  steps: data.steps.toList(growable: false),
  sourceUrl: data.sourceUrl,
  warnings: data.warnings.toList(growable: false),
);

AiRecipeDraftIngredient _aiRecipeDraftIngredientFromGraphQL(
  GRecipeDraftFields_ingredients data,
) => AiRecipeDraftIngredient(
  raw: data.raw,
  name: data.name,
  quantity: data.quantity,
  unit: data.unit,
  notes: data.notes,
);
