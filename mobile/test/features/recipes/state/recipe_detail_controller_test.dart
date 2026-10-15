import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/state/recipe_detail_controller.dart';
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
  ingredients: const <RecipeIngredient>[
    RecipeIngredient(id: 'ing-1', name: 'Toor dal', isStaple: true),
  ],
  steps: const <String>['Boil the dal.'],
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

const RecipeDetailArg _arg = (householdId: 'household-1', id: 'recipe-1');

ProviderContainer _container(FakeRecipeRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('RecipeDetailController — build', () {
    test('fetches the recipe it is keyed on', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);

      final Recipe recipe = await container.read(
        recipeDetailControllerProvider(_arg).future,
      );

      expect(recipe, _dalRecipe);
      expect(repository.detailCalls, <String>['recipe-1']);
    });

    test('two ids are independent caches, not one shared slot', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);

      await container.read(
        recipeDetailControllerProvider((householdId: 'household-1', id: 'a')).future,
      );
      await container.read(
        recipeDetailControllerProvider((householdId: 'household-1', id: 'b')).future,
      );

      expect(repository.detailCalls, <String>['a', 'b']);
    });

    test('a fetch failure lands in state with its concrete AppError subtype', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailError: const NotFoundError('Recipe not found.'),
      );
      final ProviderContainer container = _container(repository);

      await expectLater(
        container.read(recipeDetailControllerProvider(_arg).future),
        throwsA(isA<NotFoundError>()),
      );
      expect(
        container.read(recipeDetailControllerProvider(_arg)).error,
        isA<NotFoundError>(),
      );
    });
  });

  group('RecipeDetailController — live updates', () {
    test('subscribes to watchRecipeChanges for the recipe\'s household', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);

      await container.read(recipeDetailControllerProvider(_arg).future);

      expect(repository.watchCalls, <String>['household-1']);
    });

    test('a pushed change event triggers a refetch', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);
      expect(repository.detailCalls, hasLength(1));

      repository.watchControllers['household-1']!.add(null);
      await Future<void>.delayed(Duration.zero);

      expect(repository.detailCalls, hasLength(2));
    });

    test('an error on the change stream is swallowed — the recipe stays as last fetched', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);

      repository.watchControllers['household-1']!.addError(
        const ForbiddenError('You are not a member of this household.'),
      );
      await Future<void>.delayed(Duration.zero);

      final AsyncValue<Recipe> state = container.read(
        recipeDetailControllerProvider(_arg),
      );
      expect(state.hasError, isFalse);
      expect(state.value, _dalRecipe);
      expect(repository.detailCalls, hasLength(1));
    });

    test('disposing the container cancels the change subscription — no refetch after', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
      );
      await container.read(recipeDetailControllerProvider(_arg).future);

      container.dispose();
      repository.watchControllers['household-1']!.add(null);
      await Future<void>.delayed(Duration.zero);

      expect(repository.detailCalls, hasLength(1));
    });
  });

  group('RecipeDetailController — applyUpdatedRecipe', () {
    test('pushes the given recipe straight into state, no network call', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);

      final Recipe favorited = Recipe(
        id: _dalRecipe.id,
        householdId: _dalRecipe.householdId,
        sourceType: _dalRecipe.sourceType,
        title: _dalRecipe.title,
        servings: _dalRecipe.servings,
        dietaryTags: _dalRecipe.dietaryTags,
        role: _dalRecipe.role,
        inRotation: _dalRecipe.inRotation,
        isFavorite: true,
        ingredients: _dalRecipe.ingredients,
        steps: _dalRecipe.steps,
        createdAt: _dalRecipe.createdAt,
        updatedAt: _dalRecipe.updatedAt,
      );

      container
          .read(recipeDetailControllerProvider(_arg).notifier)
          .applyUpdatedRecipe(favorited);

      expect(
        container.read(recipeDetailControllerProvider(_arg)).value?.isFavorite,
        isTrue,
      );
      // Only the initial build() fetch — applyUpdatedRecipe never calls the
      // repository.
      expect(repository.detailCalls, hasLength(1));
    });
  });
}
