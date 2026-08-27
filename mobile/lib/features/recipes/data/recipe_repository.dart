import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/on_recipe_changed.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/on_recipe_changed.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/on_recipe_changed.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/recipes.var.gql.dart';
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
