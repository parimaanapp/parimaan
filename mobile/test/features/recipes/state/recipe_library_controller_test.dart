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

void main() {
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
        <({String householdId, RecipeRole? role, bool? isFavorite})>[
          (householdId: 'household-1', role: null, isFavorite: null),
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
      await Future<void>.delayed(Duration.zero);

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
