import 'package:mobile/features/catalog/data/catalog_repository.dart';
import 'package:mobile/features/catalog/domain/catalog_ingredient.dart';

/// Canned catalog rows shared by the picker and row-editor tests.
const CatalogIngredient fixtureToorDal = CatalogIngredient(
  id: 'toor_dal',
  name: 'Toor Dal',
  category: 'dal',
  categoryLabel: 'Dal',
  allowedUnits: <String>['g', 'kg', 'cup'],
  defaultUnit: 'g',
  aliases: <String>['arhar', 'tuvar'],
);

const CatalogIngredient fixtureTomato = CatalogIngredient(
  id: 'tomato',
  name: 'Tomato',
  category: 'produce',
  categoryLabel: 'Produce',
  allowedUnits: <String>['g', 'kg', 'piece'],
  defaultUnit: 'g',
  aliases: <String>['tamatar'],
);

/// Hand-written [CatalogRepository] double: records every query and answers
/// from a fixed list with a simple name/alias substring match (the real
/// ranking is the server's job and is covered there).
class FakeCatalogRepository implements CatalogRepository {
  FakeCatalogRepository({
    this.catalog = const <CatalogIngredient>[fixtureToorDal, fixtureTomato],
    this.error,
  });

  final List<CatalogIngredient> catalog;

  /// When non-null every search throws it.
  Object? error;

  final List<String> queries = <String>[];

  @override
  Future<List<CatalogIngredient>> searchIngredients(
    String query, {
    int limit = CatalogRepository.defaultSearchLimit,
  }) async {
    queries.add(query);
    final Object? failure = error;
    if (failure != null) {
      throw failure;
    }
    final String needle = query.trim().toLowerCase();
    if (needle.isEmpty) {
      return const <CatalogIngredient>[];
    }
    return catalog
        .where(
          (CatalogIngredient i) =>
              i.name.toLowerCase().contains(needle) ||
              i.aliases.any((String a) => a.toLowerCase().contains(needle)),
        )
        .take(limit)
        .toList(growable: false);
  }
}
