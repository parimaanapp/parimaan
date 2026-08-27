import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.data.gql.dart';
import '../domain/recipe.dart';
import '../domain/recipe_role.dart';
import '../domain/recipe_source.dart';

/// The boundary where Ferry / `built_value` types become the plain domain
/// [Recipe] — same rule and precedent as `features/pantry/data/pantry_mapper.dart`.
///
/// Takes `Query.recipes`' own generated element type directly rather than a
/// shared fragment interface: unlike `PantryItemFields`, there is only one
/// operation that produces this exact (non-`ingredients`) shape so far — a
/// Detail-scale query (a later slice) selects `ingredients` too and is a
/// genuinely different selection set, not a superset this type could safely
/// widen to cover without over-fetching the Library. `ingredients` is left
/// `null` here, matching [Recipe.ingredients]'s own "not fetched" doc.
Recipe recipeFromGraphQL(GRecipesData_recipes data) => Recipe(
  id: data.id,
  householdId: data.householdId,
  sourceType: _recipeSourceFromGraphQL(data.sourceType),
  sourceUrl: data.sourceUrl,
  title: data.title,
  description: data.description,
  servings: data.servings,
  prepMin: data.prepMin,
  cookMin: data.cookMin,
  // Carried through as the server's own enum value name, matching
  // `HouseholdSettings`' identical choice (`household_mapper.dart`) — see
  // `Recipe`'s own class doc for why these two fields stay raw strings.
  cuisineTier1: data.cuisineTier1?.name,
  cuisineTier2: data.cuisineTier2,
  dietaryTags: data.dietaryTags
      .map((GDietaryTag value) => value.name)
      .toList(growable: false),
  role: _recipeRoleFromGraphQL(data.role),
  inRotation: data.inRotation,
  isFavorite: data.isFavorite,
  steps: data.steps.toList(growable: false),
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
);

/// Visible for reuse by future recipe operations (create/update/favorite/
/// setInRotation, later slices) that share this same schema-level enum —
/// same "one mapper function per schema enum" shape
/// `householdRoleFromGraphQL` establishes.
RecipeRole _recipeRoleFromGraphQL(GRecipeRole role) => switch (role) {
  GRecipeRole.breakfast => RecipeRole.breakfast,
  GRecipeRole.carb => RecipeRole.carb,
  GRecipeRole.sabzi_dal => RecipeRole.sabziDal,
  GRecipeRole.accompaniment => RecipeRole.accompaniment,
  GRecipeRole.snack => RecipeRole.snack,
  GRecipeRole.sweet => RecipeRole.sweet,
  GRecipeRole.drink => RecipeRole.drink,
  _ => RecipeRole.unknown,
};

/// See [_recipeRoleFromGraphQL].
RecipeSource _recipeSourceFromGraphQL(GRecipeSource source) => switch (source) {
  GRecipeSource.user => RecipeSource.user,
  GRecipeSource.url => RecipeSource.url,
  GRecipeSource.curated => RecipeSource.curated,
  GRecipeSource.ai => RecipeSource.ai,
  GRecipeSource.freeform_ai => RecipeSource.freeformAi,
  _ => RecipeSource.unknown,
};

/// The generated `GRecipeRole` for a domain [RecipeRole] — the write
/// direction, for `Query.recipes`' own `$role` filter variable. `unknown`
/// has no wire value to send; a caller filtering by it is a logic error this
/// function does not attempt to paper over — `RecipeRole.selectable` (the
/// filter-chip list) never includes it in the first place.
GRecipeRole recipeRoleToGraphQL(RecipeRole role) => switch (role) {
  RecipeRole.breakfast => GRecipeRole.breakfast,
  RecipeRole.carb => GRecipeRole.carb,
  RecipeRole.sabziDal => GRecipeRole.sabzi_dal,
  RecipeRole.accompaniment => GRecipeRole.accompaniment,
  RecipeRole.snack => GRecipeRole.snack,
  RecipeRole.sweet => GRecipeRole.sweet,
  RecipeRole.drink => GRecipeRole.drink,
  RecipeRole.unknown => throw ArgumentError(
    'RecipeRole.unknown has no wire value to filter by.',
  ),
};
