import 'package:built_collection/built_collection.dart';

import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipe_detail_fields.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.data.gql.dart';
import '../domain/recipe.dart';
import '../domain/recipe_draft.dart';
import '../domain/recipe_ingredient.dart';
import '../domain/recipe_ingredient_draft.dart';
import '../domain/recipe_patch.dart';
import '../domain/recipe_role.dart';
import '../domain/recipe_source.dart';

/// The boundary where Ferry / `built_value` types become the plain domain
/// [Recipe] — same rule and precedent as `features/pantry/data/pantry_mapper.dart`.
///
/// Takes `Query.recipes`' own generated element type directly rather than
/// [GRecipeDetailFields] (below): the Library query is a genuinely
/// different, narrower selection set (no `ingredients`), not a subset of
/// the Detail-scale fragment this type could reuse without over-fetching
/// the Library (E2E_MVP_PLAN.md §12.2.7/D5). `ingredients` is left `null`
/// here, matching [Recipe.ingredients]'s own "not fetched" doc.
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

/// The Detail-scale counterpart to [recipeFromGraphQL]. Takes the
/// **fragment** interface `GRecipeDetailFields`, not any one operation's own
/// generated element type — `RecipeDetail`/`FavoriteRecipe`/`SetInRotation`/
/// `DeleteRecipe` (W6 S7) all spread `RecipeDetailFields`, so this one
/// mapper serves every operation that returns a full recipe, the same
/// `PantryItemFields` shape `pantry_mapper.dart` establishes. `ingredients`
/// is populated here, matching [Recipe.ingredients]'s "a non-null (possibly
/// empty) list once a Detail-scale query has" doc.
Recipe recipeDetailFromGraphQL(GRecipeDetailFields data) => Recipe(
  id: data.id,
  householdId: data.householdId,
  sourceType: _recipeSourceFromGraphQL(data.sourceType),
  sourceUrl: data.sourceUrl,
  title: data.title,
  description: data.description,
  servings: data.servings,
  prepMin: data.prepMin,
  cookMin: data.cookMin,
  cuisineTier1: data.cuisineTier1?.name,
  cuisineTier2: data.cuisineTier2,
  dietaryTags: data.dietaryTags
      .map((GDietaryTag value) => value.name)
      .toList(growable: false),
  role: _recipeRoleFromGraphQL(data.role),
  inRotation: data.inRotation,
  isFavorite: data.isFavorite,
  ingredients: data.ingredients
      .map(_recipeIngredientFromGraphQL)
      .toList(growable: false),
  steps: data.steps.toList(growable: false),
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
);

RecipeIngredient _recipeIngredientFromGraphQL(
  GRecipeDetailFields_ingredients data,
) => RecipeIngredient(
  id: data.id,
  name: data.name,
  quantity: data.quantity,
  unit: data.unit,
  category: data.category,
  notes: data.notes,
  isStaple: data.isStaple,
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

/// [RecipeDraft] → `RecipeInput` (W6 S8, `Mutation.createRecipe`).
GRecipeInput recipeDraftToGraphQL(RecipeDraft draft) => GRecipeInput(
  (GRecipeInputBuilder b) => b
    ..title = draft.title
    ..description = draft.description
    ..servings = draft.servings
    ..prepMin = draft.prepMin
    ..cookMin = draft.cookMin
    ..cuisineTier1 = _cuisineTier1ToGraphQL(draft.cuisineTier1)
    ..cuisineTier2 = draft.cuisineTier2
    ..dietaryTags = _dietaryTagsToGraphQL(draft.dietaryTags)
    ..role = recipeRoleToGraphQL(draft.role)
    ..inRotation = draft.inRotation
    ..ingredients.addAll(draft.ingredients.map(_recipeIngredientDraftToGraphQL))
    ..steps.addAll(draft.steps),
);

/// [RecipePatch] → `RecipePatchInput` (W6 S8, `Mutation.updateRecipe`).
/// `ingredients`/`steps` carry [RecipePatch]'s own null-means-unchanged /
/// any-list-means-replace semantic straight through — a `null` here never
/// reaches the builder call at all (the field stays unset, i.e. absent on
/// the wire, exactly like every other unset field in this input), and a
/// non-null (possibly empty) list is always sent whole.
GRecipePatchInput recipePatchToGraphQL(RecipePatch patch) => GRecipePatchInput(
  (GRecipePatchInputBuilder b) {
    b
      ..title = patch.title
      ..description = patch.description
      ..servings = patch.servings
      ..prepMin = patch.prepMin
      ..cookMin = patch.cookMin
      ..cuisineTier1 = _cuisineTier1ToGraphQL(patch.cuisineTier1)
      ..cuisineTier2 = patch.cuisineTier2
      ..dietaryTags = _dietaryTagsToGraphQL(patch.dietaryTags)
      ..role = patch.role == null ? null : recipeRoleToGraphQL(patch.role!)
      ..inRotation = patch.inRotation;
    final List<RecipeIngredientDraft>? ingredients = patch.ingredients;
    if (ingredients != null) {
      b.ingredients = ListBuilder<GRecipeIngredientInput>(
        ingredients.map(_recipeIngredientDraftToGraphQL),
      );
    }
    final List<String>? steps = patch.steps;
    if (steps != null) {
      b.steps = ListBuilder<String>(steps);
    }
  },
);

GRecipeIngredientInput _recipeIngredientDraftToGraphQL(RecipeIngredientDraft draft) =>
    GRecipeIngredientInput(
      (GRecipeIngredientInputBuilder b) => b
        ..name = draft.name
        ..quantity = draft.quantity
        ..unit = draft.unit
        ..category = draft.category
        ..notes = draft.notes
        ..isStaple = draft.isStaple,
    );

/// The raw wire-value string [Recipe.cuisineTier1] is kept as, converted
/// back to the generated enum `GCuisineTier1.valueOf` expects — the write
/// direction [Recipe]'s own class doc anticipates. `null` in, `null` out.
GCuisineTier1? _cuisineTier1ToGraphQL(String? value) =>
    value == null ? null : GCuisineTier1.valueOf(value);

/// Same shape as [_cuisineTier1ToGraphQL], for the wire-value strings
/// [Recipe.dietaryTags] carries. `null` in (unset on a patch) stays `null`,
/// not an empty list — those are different states (§ [RecipePatch]'s own
/// doc). Returns a `ListBuilder`, not a `BuiltList` — that's what the
/// generated input builders' own list-field setters expect.
ListBuilder<GDietaryTag>? _dietaryTagsToGraphQL(List<String>? values) =>
    values == null
        ? null
        : ListBuilder<GDietaryTag>(values.map(GDietaryTag.valueOf));
