import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/delete_recipe.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_recipe.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/delete_recipe.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/favorite_recipe.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/favorite_recipe.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/favorite_recipe.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/on_recipe_changed.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/on_recipe_changed.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/on_recipe_changed.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipe_detail.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipe_detail.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipe_detail.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/set_in_rotation.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/set_in_rotation.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/set_in_rotation.var.gql.dart';
import '../domain/recipe.dart';
import '../domain/recipe_role.dart';
import 'recipe_mapper.dart';

/// The app's recipe surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of [AppError] and
/// nothing else — same contract as `PantryRepository`.
abstract interface class RecipeRepository {
  /// Reads [householdId]'s recipes, optionally filtered by [role] and/or
  /// [isFavorite] — both applied server-side
  /// (`api/src/repositories/recipeRepository.ts`), not by this client
  /// filtering an already-fetched list. Never populates
  /// [Recipe.ingredients] — see the `Recipes` query's own doc.
  ///
  /// Requires the caller to already be a member of [householdId]; a
  /// non-member gets [ForbiddenError], identically to a nonexistent id.
  Future<List<Recipe>> fetchRecipes(
    String householdId, {
    RecipeRole? role,
    bool? isFavorite,
  });

  /// Emits once every time another device creates, updates, deletes,
  /// favorites, or rotation-flags a recipe in [householdId]'s library (W6
  /// S11, D6) — a pure "something changed, refetch" signal, not the changed
  /// recipe itself. Same "every push means refetch" reasoning as
  /// `PantryRepository.watchPantryChanges`'s own doc: all five recipe
  /// mutations push the identical `Recipe` shape on the wire with no
  /// event-type field, so a full refetch is correct in every case (add,
  /// update, delete, favorite, rotation) with no special-casing — and it's
  /// the only way a delete or a filter-relevant change is ever reflected
  /// correctly, since a local patch can't tell whether the changed recipe
  /// newly matches (or stops matching) the caller's current role/favorites
  /// filter.
  ///
  /// Errors surface through this stream — `RecipeLibraryController`
  /// deliberately swallows them rather than failing the whole recipe read,
  /// same as `PantryController`.
  Stream<void> watchRecipeChanges(String householdId);

  /// Reads one recipe by [id], including [Recipe.ingredients] (W6 S7) —
  /// `Query.recipe`, added specifically so the Detail screen never
  /// re-fetches the whole household's `Query.recipes` list just to display
  /// one row (see `Query.recipe`'s own schema doc). Takes no `householdId`;
  /// a nonexistent [id] and a real [id] in another household both throw the
  /// identical [NotFoundError].
  Future<Recipe> fetchRecipeDetail(String id);

  /// Sets whether the recipe [id] is favorited to [favorite] — the desired
  /// end state, not a toggle, so repeat calls with the same value are
  /// idempotent. Returns the whole updated [Recipe] (including
  /// [Recipe.ingredients]), so a caller can push it straight into
  /// `RecipeDetailController`'s state without a second round trip — the
  /// `HouseholdSettingsController.rotateInviteCode` pattern, not
  /// `PantryFormController`'s invalidate-and-refetch one.
  Future<Recipe> favoriteRecipe(String id, bool favorite);

  /// Sets whether the recipe [id] is in rotation to [inRotation] — same
  /// end-state-not-toggle, whole-`Recipe`-returned shape as [favoriteRecipe].
  Future<Recipe> setInRotation(String id, bool inRotation);

  /// Deletes the recipe [id] and returns the deleted row. Same `id`-only
  /// membership resolution as [favoriteRecipe]/[setInRotation].
  Future<Recipe> deleteRecipe(String id);
}

/// Ferry-backed [RecipeRepository].
///
/// The only file besides `recipe_mapper.dart` that touches generated
/// GraphQL types — same boundary rule as `FerryPantryRepository`.
class FerryRecipeRepository implements RecipeRepository {
  const FerryRecipeRepository({required this.client});

  final Client client;

  @override
  Future<List<Recipe>> fetchRecipes(
    String householdId, {
    RecipeRole? role,
    bool? isFavorite,
  }) async {
    final GRecipesReq request = GRecipesReq(
      (GRecipesReqBuilder b) => b
        ..vars = (GRecipesVarsBuilder()
          ..householdId = householdId
          ..role = role == null ? null : recipeRoleToGraphQL(role)
          ..isFavorite = isFavorite)
        // Same `FetchPolicy.NoCache` reasoning as `PantryRepository.fetchPantry`:
        // no subscription in this slice (that's S11), so a cached answer to a
        // role/favorite filter change would be a stale one.
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GRecipesData data = await _execute(request);
    return data.recipes.map(recipeFromGraphQL).toList(growable: false);
  }

  @override
  Stream<void> watchRecipeChanges(String householdId) async* {
    final GOnRecipeChangedReq request = GOnRecipeChangedReq(
      (GOnRecipeChangedReqBuilder b) => b
        ..vars = (GOnRecipeChangedVarsBuilder()..householdId = householdId),
    );

    await for (final OperationResponse<GOnRecipeChangedData, GOnRecipeChangedVars> response
        in client.request(request)) {
      if (response.hasErrors) {
        throw mapOperationFailure(
          graphqlErrors: response.graphqlErrors,
          linkException: response.linkException,
        );
      }
      if (response.data != null) {
        yield null;
      }
    }
  }

  @override
  Future<Recipe> fetchRecipeDetail(String id) async {
    final GRecipeDetailReq request = GRecipeDetailReq(
      (GRecipeDetailReqBuilder b) => b
        ..vars = (GRecipeDetailVarsBuilder()..id = id)
        // Same `FetchPolicy.NoCache` reasoning as `fetchRecipes`: the
        // Detail screen subscribes to `watchRecipeChanges` for live
        // updates rather than relying on a cache that a mutation from
        // another device would silently leave stale.
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GRecipeDetailData data = await _execute(request);
    return recipeDetailFromGraphQL(data.recipe);
  }

  @override
  Future<Recipe> favoriteRecipe(String id, bool favorite) async {
    final GFavoriteRecipeReq request = GFavoriteRecipeReq(
      (GFavoriteRecipeReqBuilder b) => b
        ..vars = (GFavoriteRecipeVarsBuilder()
          ..id = id
          ..favorite = favorite),
    );

    final GFavoriteRecipeData data = await _execute(request);
    return recipeDetailFromGraphQL(data.favoriteRecipe);
  }

  @override
  Future<Recipe> setInRotation(String id, bool inRotation) async {
    final GSetInRotationReq request = GSetInRotationReq(
      (GSetInRotationReqBuilder b) => b
        ..vars = (GSetInRotationVarsBuilder()
          ..id = id
          ..inRotation = inRotation),
    );

    final GSetInRotationData data = await _execute(request);
    return recipeDetailFromGraphQL(data.setInRotation);
  }

  @override
  Future<Recipe> deleteRecipe(String id) async {
    final GDeleteRecipeReq request = GDeleteRecipeReq(
      (GDeleteRecipeReqBuilder b) => b..vars = (GDeleteRecipeVarsBuilder()..id = id),
    );

    final GDeleteRecipeData data = await _execute(request);
    return recipeDetailFromGraphQL(data.deleteRecipe);
  }

  /// Identical reduction to `FerryPantryRepository._execute` — see that
  /// method's doc for why "first settled response", not `stream.first`.
  Future<TData> _execute<TData, TVars>(
    OperationRequest<TData, TVars> request,
  ) async {
    OperationResponse<TData, TVars>? settled;
    await for (final OperationResponse<TData, TVars> response in client.request(
      request,
    )) {
      if (response.data != null || response.hasErrors) {
        settled = response;
        break;
      }
    }

    if (settled == null) {
      throw const InternalError(genericErrorMessage);
    }

    final TData? data = settled.data;
    if (settled.hasErrors || data == null) {
      throw mapOperationFailure(
        graphqlErrors: settled.graphqlErrors,
        linkException: settled.linkException,
      );
    }
    return data;
  }
}

/// Injection point for [RecipeRepository] — same composition-over-throwing
/// shape as `pantryRepositoryProvider`.
final Provider<RecipeRepository> recipeRepositoryProvider =
    Provider<RecipeRepository>(
      (Ref ref) => FerryRecipeRepository(client: ref.watch(ferryClientProvider)),
    );
