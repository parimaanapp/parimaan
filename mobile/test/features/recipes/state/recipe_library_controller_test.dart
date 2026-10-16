import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/state/recipe_library_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_recipe_repository.dart';

final Recipe _dalRecipe = Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: 'Toor Dal',
  servings: 4,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: true,
  isFavorite: false,
  steps: const <String>['Boil the dal.'],
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

ProviderContainer _container(FakeRecipeRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  return container;
}

List<Recipe> _recipes(int count) => <Recipe>[
  for (int i = 0; i < count; i++)
    Recipe(
      id: 'recipe-$i',
      householdId: 'household-1',
      sourceType: RecipeSource.user,
      title: 'Recipe $i',
      servings: 4,
      dietaryTags: const <String>[],
      role: RecipeRole.sabziDal,
      inRotation: false,
      isFavorite: false,
      steps: const <String>[],
      createdAt: DateTime.utc(2026, 8, 25),
      updatedAt: DateTime.utc(2026, 8, 25),
    ),
];

/// Longer than the controller's live-update coalescing window.
const Duration _settle = Duration(milliseconds: 650);

void main() {
  _controllerCacheTests();
  _paginationTests();
  group('RecipeLibraryController — build', () {
    test('fetches the household it is keyed on, unfiltered', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);

      final List<Recipe> recipes = await container.read(
        recipeLibraryControllerProvider('household-1').future,
      );

      expect(recipes, <Recipe>[_dalRecipe]);
      expect(
        repository.calls,
        <({String householdId, RecipeRole? role, bool? isFavorite, bool? inRotation})>[
          (householdId: 'household-1', role: null, isFavorite: null, inRotation: null),
        ],
      );
    });

    test('two ids are independent caches, not one shared slot', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);

      await container.read(recipeLibraryControllerProvider('a').future);
      await container.read(recipeLibraryControllerProvider('b').future);

      expect(repository.calls.map((c) => c.householdId), <String>['a', 'b']);
    });

    test('is in a loading state before the fetch resolves', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
        delay: const Duration(milliseconds: 20),
      );
      final ProviderContainer container = _container(repository);

      final AsyncValue<List<Recipe>> initial = container.read(
        recipeLibraryControllerProvider('household-1'),
      );
      expect(initial, isA<AsyncLoading<List<Recipe>>>());

      await container.read(recipeLibraryControllerProvider('household-1').future);
      expect(
        container.read(recipeLibraryControllerProvider('household-1')),
        isA<AsyncData<List<Recipe>>>(),
      );
    });

    test('a fetch failure lands in state with its concrete AppError subtype', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        error: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);

      await expectLater(
        container.read(recipeLibraryControllerProvider('household-1').future),
        throwsA(isA<ForbiddenError>()),
      );
      expect(
        container.read(recipeLibraryControllerProvider('household-1')).error,
        isA<ForbiddenError>(),
      );
    });
  });

  group('RecipeLibraryController — setRoleFilter', () {
    test('refetches immediately with the role filter, no debounce', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);

      await container
          .read(recipeLibraryControllerProvider('household-1').notifier)
          .setRoleFilter(RecipeRole.sabziDal);

      expect(repository.calls.last.role, RecipeRole.sabziDal);
    });

    test('a failed role refetch keeps the last good list on screen', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);

      repository.error = const InternalError('network down');
      await container
          .read(recipeLibraryControllerProvider('household-1').notifier)
          .setRoleFilter(RecipeRole.sabziDal);

      final AsyncValue<List<Recipe>> state = container.read(
        recipeLibraryControllerProvider('household-1'),
      );
      expect(state.hasError, isTrue);
      expect(state.valueOrNull, <Recipe>[_dalRecipe]);
    });
  });

  group('RecipeLibraryController — setFavoritesFilter', () {
    test('refetches immediately with the favorites filter, no debounce', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);

      await container
          .read(recipeLibraryControllerProvider('household-1').notifier)
          .setFavoritesFilter(true);

      expect(repository.calls.last.isFavorite, isTrue);
    });

    test('a failed favorites refetch keeps the last good list on screen', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);

      repository.error = const InternalError('network down');
      await container
          .read(recipeLibraryControllerProvider('household-1').notifier)
          .setFavoritesFilter(true);

      final AsyncValue<List<Recipe>> state = container.read(
        recipeLibraryControllerProvider('household-1'),
      );
      expect(state.hasError, isTrue);
      expect(state.valueOrNull, <Recipe>[_dalRecipe]);
    });
  });

  group('RecipeLibraryController — live updates (S11)', () {
    test('subscribes to watchRecipeChanges for the household it is keyed on', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);

      await container.read(recipeLibraryControllerProvider('household-1').future);

      expect(repository.watchCalls, <String>['household-1']);
    });

    test('a pushed change event triggers a refetch', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);
      expect(repository.calls, hasLength(1));

      repository.watchControllers['household-1']!.add(null);
      await Future<void>.delayed(_settle);

      expect(repository.calls, hasLength(2));
    });

    test('an error on the change stream is swallowed — the library stays as last fetched', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);

      repository.watchControllers['household-1']!.addError(
        const ForbiddenError('You are not a member of this household.'),
      );
      await Future<void>.delayed(Duration.zero);

      final AsyncValue<List<Recipe>> state = container.read(
        recipeLibraryControllerProvider('household-1'),
      );
      expect(state.hasError, isFalse);
      expect(state.value, <Recipe>[_dalRecipe]);
      // No second fetch — an errored change-stream event is not a
      // "something changed" signal.
      expect(repository.calls, hasLength(1));
    });

    test('disposing the container cancels the change subscription — no refetch after', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
      );
      await container.read(recipeLibraryControllerProvider('household-1').future);

      container.dispose();
      // Broadcast controllers accept `.add` with no listeners without
      // throwing — this only proves the controller-side subscription is
      // gone by asserting no refetch call landed, not that `.add` itself
      // would have failed.
      repository.watchControllers['household-1']!.add(null);
      await Future<void>.delayed(Duration.zero);

      expect(repository.calls, hasLength(1));
    });
  });
}

void _controllerCacheTests() {
  group('RecipeLibraryController — caching', () {
    test('a second read of the same household does not refetch', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);

      await container.read(recipeLibraryControllerProvider('h').future);
      // A tab switch re-mounts the screen, which re-reads the provider.
      await container.read(recipeLibraryControllerProvider('h').future);
      container.read(recipeLibraryControllerProvider('h'));

      expect(repository.calls.length, 1);
    });

    test('invalidation keeps showing the cached list while it reloads', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);

      repository.delay = const Duration(milliseconds: 20);
      container.invalidate(recipeLibraryControllerProvider('h'));
      final AsyncValue<List<Recipe>> during = container.read(
        recipeLibraryControllerProvider('h'),
      );

      expect(during.isLoading, isTrue);
      expect(during.valueOrNull, <Recipe>[_dalRecipe]);
      await container.read(recipeLibraryControllerProvider('h').future);
    });

    test('a rebuild after invalidation keeps the selected filter', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      await container
          .read(recipeLibraryControllerProvider('h').notifier)
          .setRoleFilter(RecipeRole.carb);

      container.invalidate(recipeLibraryControllerProvider('h'));
      await container.read(recipeLibraryControllerProvider('h').future);

      expect(repository.calls.last.role, RecipeRole.carb);
    });

    test('clearFilters drops role and favorites in a single refetch', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );
      await container.read(recipeLibraryControllerProvider('h').future);
      await controller.setRoleFilter(RecipeRole.carb);
      await controller.setFavoritesFilter(true);
      final int before = repository.calls.length;

      await controller.clearFilters();

      expect(repository.calls.length, before + 1);
      expect(repository.calls.last.role, isNull);
      expect(repository.calls.last.isFavorite, isNull);
    });
  });
}

void _paginationTests() {
  const int page = RecipeLibraryController.pageSize;

  group('RecipeLibraryController — pagination (B2c)', () {
    test('the first fetch asks for one page from offset 0', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page * 2 + 5),
      );
      final ProviderContainer container = _container(repository);

      final List<Recipe> first = await container.read(
        recipeLibraryControllerProvider('h').future,
      );

      expect(first, hasLength(page));
      expect(repository.pageCalls.single, (limit: page, offset: 0));
      expect(
        container.read(recipeLibraryControllerProvider('h').notifier).hasMore,
        isTrue,
      );
    });

    test('a short first page means there is nothing more to load', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(3),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);

      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );
      expect(controller.hasMore, isFalse);

      await controller.loadMore();
      expect(repository.pageCalls, hasLength(1));
    });

    test('loadMore appends the next page and stops at a short page', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page + 7),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );

      await controller.loadMore();

      final List<Recipe>? all = container
          .read(recipeLibraryControllerProvider('h'))
          .valueOrNull;
      expect(all, hasLength(page + 7));
      expect(all!.map((Recipe r) => r.id).toSet(), hasLength(page + 7));
      expect(repository.pageCalls.last, (limit: page, offset: page));
      expect(controller.hasMore, isFalse);
    });

    test('concurrent loadMore calls fetch the page once', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page * 3),
        delay: const Duration(milliseconds: 5),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );

      await Future.wait(<Future<void>>[
        controller.loadMore(),
        controller.loadMore(),
      ]);

      expect(repository.pageCalls, hasLength(2));
    });

    test('a failed loadMore keeps the loaded list and can be retried', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page * 2),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );

      repository.error = const ForbiddenError('nope');
      await controller.loadMore();
      final AsyncValue<List<Recipe>> failed = container.read(
        recipeLibraryControllerProvider('h'),
      );
      expect(failed.hasError, isTrue);
      expect(failed.valueOrNull, hasLength(page));
      expect(controller.hasMore, isTrue);

      expect(controller.loadMoreFailed, isTrue);
      // A scroll-driven call does not hammer a failing server...
      repository.error = null;
      await controller.loadMore();
      expect(repository.pageCalls, hasLength(2));
      // ...only an explicit retry does.
      await controller.loadMore(retry: true);
      expect(controller.loadMoreFailed, isFalse);
      expect(
        container.read(recipeLibraryControllerProvider('h')).valueOrNull,
        hasLength(page * 2),
      );
    });

    test('a filter change starts again from the first page', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page * 3),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );
      await controller.loadMore();

      await controller.setRoleFilter(RecipeRole.carb);

      expect(repository.pageCalls.last, (limit: page, offset: 0));
      expect(
        container.read(recipeLibraryControllerProvider('h')).valueOrNull,
        hasLength(page),
      );
    });

    test('a live update refetches every page already loaded', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page * 3),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      await container
          .read(recipeLibraryControllerProvider('h').notifier)
          .loadMore();

      repository.watchControllers['h']!.add(null);
      await Future<void>.delayed(_settle);

      expect(repository.pageCalls.last, (limit: page * 2, offset: 0));
      expect(
        container.read(recipeLibraryControllerProvider('h')).valueOrNull,
        hasLength(page * 2),
      );
    });

    test('a stale loadMore cannot overwrite a newer filter result', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page * 3),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );

      repository.delayForRole = (RecipeRole? r) =>
          r == null ? const Duration(milliseconds: 60) : Duration.zero;
      final Future<void> slow = controller.loadMore();
      final Future<void> fast = controller.setRoleFilter(RecipeRole.carb);
      await Future.wait(<Future<void>>[slow, fast]);

      expect(
        container.read(recipeLibraryControllerProvider('h')).valueOrNull,
        hasLength(page),
      );
      expect(controller.isLoadingMore, isFalse);
    });

    test('rapid filter taps end on the last tapped, not the last finished', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(10),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );
      repository.resultForRole = (RecipeRole? r) =>
          r == RecipeRole.carb ? _recipes(3) : _recipes(7);
      repository.delayForRole = (RecipeRole? r) => r == RecipeRole.carb
          ? const Duration(milliseconds: 60)
          : Duration.zero;

      final Future<void> first = controller.setRoleFilter(RecipeRole.carb);
      final Future<void> second = controller.setRoleFilter(RecipeRole.snack);
      await Future.wait(<Future<void>>[first, second]);

      expect(
        container.read(recipeLibraryControllerProvider('h')).valueOrNull,
        hasLength(7),
      );
    });

    test('an invalidation rebuild keeps the loaded row count', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(page * 3),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      await container
          .read(recipeLibraryControllerProvider('h').notifier)
          .loadMore();

      container.invalidate(recipeLibraryControllerProvider('h'));
      final List<Recipe> rebuilt = await container.read(
        recipeLibraryControllerProvider('h').future,
      );

      expect(rebuilt, hasLength(page * 2));
      expect(repository.pageCalls.last, (limit: page * 2, offset: 0));
    });

    test('refetching more than 200 rows pages in chunks of at most 200', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(400),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      final RecipeLibraryController controller = container.read(
        recipeLibraryControllerProvider('h').notifier,
      );
      for (int i = 0; i < 4; i++) {
        await controller.loadMore();
      }
      expect(
        container.read(recipeLibraryControllerProvider('h')).valueOrNull,
        hasLength(250),
      );
      repository.pageCalls.clear();

      repository.watchControllers['h']!.add(null);
      await Future<void>.delayed(_settle);

      expect(repository.pageCalls, <({int? limit, int? offset})>[
        (limit: 200, offset: 0),
        (limit: 50, offset: 200),
      ]);
      expect(
        container.read(recipeLibraryControllerProvider('h')).valueOrNull,
        hasLength(250),
      );
    });

    test('a burst of live updates coalesces into one refetch', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: _recipes(10),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('h').future);
      repository.pageCalls.clear();

      for (int i = 0; i < 3; i++) {
        repository.watchControllers['h']!.add(null);
        await Future<void>.delayed(const Duration(milliseconds: 100));
      }
      await Future<void>.delayed(_settle);

      expect(repository.pageCalls, hasLength(1));
    });
  });
}
