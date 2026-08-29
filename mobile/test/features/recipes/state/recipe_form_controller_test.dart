import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_draft.dart';
import 'package:mobile/features/recipes/domain/recipe_patch.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/domain/recipe_source_attribution.dart';
import 'package:mobile/features/recipes/state/recipe_detail_controller.dart';
import 'package:mobile/features/recipes/state/recipe_form_controller.dart';
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

const RecipeDraft _draft = RecipeDraft(title: 'Toor Dal', role: RecipeRole.sabziDal);
const RecipeDetailArg _arg = (householdId: 'household-1', id: 'recipe-1');

ProviderContainer _container(FakeRecipeRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('RecipeFormController — create', () {
    test('returns true on success', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(recipeFormControllerProvider.notifier)
          .create('household-1', _draft);

      expect(ok, isTrue);
      expect(repository.createCalls, hasLength(1));
      expect(repository.createCalls.single.householdId, 'household-1');
      expect(repository.createCalls.single.source, isNull);
    });

    test('threads an optional source attribution through to the repository', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);

      await container
          .read(recipeFormControllerProvider.notifier)
          .create(
            'household-1',
            _draft,
            source: const RecipeSourceAttribution(
              sourceType: RecipeSource.freeformAi,
            ),
          );

      expect(repository.createCalls, hasLength(1));
      expect(
        repository.createCalls.single.source!.sourceType,
        RecipeSource.freeformAi,
      );
    });

    test('invalidates the library provider for that household on success', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createResult: _dalRecipe,
        result: <Recipe>[],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);
      expect(repository.calls, hasLength(1));

      await container
          .read(recipeFormControllerProvider.notifier)
          .create('household-1', _draft);
      await container.read(recipeLibraryControllerProvider('household-1').future);

      expect(repository.calls, hasLength(2));
    });

    test('returns false and preserves the AppError subtype on failure', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createError: const ValidationError('title must not be empty'),
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(recipeFormControllerProvider.notifier)
          .create('household-1', _draft);

      expect(ok, isFalse);
      expect(
        container.read(recipeFormControllerProvider).error,
        isA<ValidationError>(),
      );
    });
  });

  group('RecipeFormController — updateRecipe', () {
    const RecipePatch patch = RecipePatch(title: 'New Title');

    test('returns true on success', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        updateResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(recipeFormControllerProvider.notifier)
          .updateRecipe(_arg, patch);

      expect(ok, isTrue);
      expect(repository.updateCalls.single.id, 'recipe-1');
    });

    test('invalidates both the library and detail providers on success', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        updateResult: _dalRecipe,
        detailResult: _dalRecipe,
        result: <Recipe>[],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);
      await container.read(recipeDetailControllerProvider(_arg).future);
      expect(repository.calls, hasLength(1));
      expect(repository.detailCalls, hasLength(1));

      await container
          .read(recipeFormControllerProvider.notifier)
          .updateRecipe(_arg, patch);
      await container.read(recipeLibraryControllerProvider('household-1').future);
      await container.read(recipeDetailControllerProvider(_arg).future);

      expect(repository.calls, hasLength(2));
      expect(repository.detailCalls, hasLength(2));
    });

    test('returns false and preserves the AppError subtype on failure', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        updateError: const NotFoundError('Recipe not found.'),
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(recipeFormControllerProvider.notifier)
          .updateRecipe(_arg, patch);

      expect(ok, isFalse);
      expect(
        container.read(recipeFormControllerProvider).error,
        isA<NotFoundError>(),
      );
    });
  });

  group('RecipeFormController — action tracking', () {
    test('reports which action is/was running, distinguishing create/update', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        createResult: _dalRecipe,
        updateResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);
      final RecipeFormController controller = container.read(
        recipeFormControllerProvider.notifier,
      );

      expect(controller.action, RecipeFormAction.none);

      await controller.create('household-1', _draft);
      expect(controller.action, RecipeFormAction.create);

      await controller.updateRecipe(_arg, const RecipePatch(title: 'New Title'));
      expect(controller.action, RecipeFormAction.update);
    });
  });
}
