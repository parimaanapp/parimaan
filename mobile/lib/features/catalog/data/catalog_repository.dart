import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/ferry_execute.dart';
import '../../../shared/graphql/operations/__generated__/search_ingredients.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/search_ingredients.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/search_ingredients.var.gql.dart';
import '../domain/catalog_ingredient.dart';

/// The app's read of the global ingredient catalog, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of `AppError` and
/// nothing else — same contract as `PantryRepository`.
abstract interface class CatalogRepository {
  /// Ranked type-ahead over catalog names and aliases. A blank [query]
  /// returns an empty list without a network call. [limit] is clamped
  /// server-side to 1..50.
  Future<List<CatalogIngredient>> searchIngredients(
    String query, {
    int limit = defaultSearchLimit,
  });

  /// Suggestions shown under the picker field.
  static const int defaultSearchLimit = 8;
}

/// Ferry-backed [CatalogRepository].
class FerryCatalogRepository
    with FerryExecuteMixin
    implements CatalogRepository {
  const FerryCatalogRepository({required this.client});

  @override
  final Client client;

  @override
  Future<List<CatalogIngredient>> searchIngredients(
    String query, {
    int limit = CatalogRepository.defaultSearchLimit,
  }) async {
    final String trimmed = query.trim();
    if (trimmed.isEmpty) {
      return const <CatalogIngredient>[];
    }
    final GSearchIngredientsReq request = GSearchIngredientsReq(
      (GSearchIngredientsReqBuilder b) => b
        ..vars = (GSearchIngredientsVarsBuilder()
          ..query = trimmed
          ..limit = limit)
        // Typing is a stream of distinct queries; a cached answer to a
        // different keystroke would only be stale.
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GSearchIngredientsData data = await execute(request);
    return data.searchIngredients
        .map(catalogIngredientFromGraphQL)
        .toList(growable: false);
  }
}

/// Maps the generated search row to the domain type.
CatalogIngredient catalogIngredientFromGraphQL(
  GSearchIngredientsData_searchIngredients data,
) => CatalogIngredient(
  id: data.id,
  name: data.name,
  category: data.category,
  categoryLabel: data.categoryLabel,
  allowedUnits: data.allowedUnits.toList(growable: false),
  defaultUnit: data.defaultUnit,
  aliases: data.aliases.toList(growable: false),
);

final Provider<CatalogRepository> catalogRepositoryProvider =
    Provider<CatalogRepository>(
      (Ref ref) => FerryCatalogRepository(client: ref.watch(ferryClientProvider)),
    );
