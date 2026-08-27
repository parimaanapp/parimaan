import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/state/recipe_detail_controller.dart';
import 'package:mobile/features/recipes/state/recipe_library_controller.dart';
import 'package:mobile/features/recipes/state/recipe_overflow_controller.dart';
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

final Recipe _favoritedRecipe = Recipe(
  id: _dalRecipe.id,
  householdId: _dalRecipe.householdId,
  sourceType: _dalRecipe.sourceType,
  title: _dalRecipe.title,
  servings: _dalRecipe.servings,
  dietaryTags: _dalRecipe.dietaryTags,
  role: _dalRecipe.role,
  inRotation: _dalRecipe.inRotation,
  isFavorite: true,
  steps: _dalRecipe.steps,
  createdAt: _dalRecipe.createdAt,
  updatedAt: _dalRecipe.updatedAt,
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
  group('RecipeOverflowController — setFavorite', () {
    test('returns true, pushes the updated recipe into RecipeDetailController', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        favoriteResult: _favoritedRecipe,
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);

      final bool ok = await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .setFavorite(true);

      expect(ok, isTrue);
      expect(repository.favoriteCalls, <({String id, bool favorite})>[
        (id: 'recipe-1', favorite: true),
      ]);
      expect(
        container.read(recipeDetailControllerProvider(_arg)).value?.isFavorite,
        isTrue,
      );
    });

    test('invalidates the library provider for the recipe\'s household on success', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        favoriteResult: _favoritedRecipe,
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);
      await container.read(recipeLibraryControllerProvider('household-1').future);
      expect(repository.calls, hasLength(1));

      await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .setFavorite(true);
      await container.read(recipeLibraryControllerProvider('household-1').future);

      expect(repository.calls, hasLength(2));
    });

    test('returns false and preserves the AppError subtype on failure, without blanking the detail', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        favoriteError: const ForbiddenError('You are not a member of this household.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);

      final bool ok = await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .setFavorite(true);

      expect(ok, isFalse);
      expect(
        container.read(recipeOverflowControllerProvider(_arg)).error,
        isA<ForbiddenError>(),
      );
      // The detail screen's own recipe must still be there — a failed
      // toggle is not a reason to blank it.
      expect(
        container.read(recipeDetailControllerProvider(_arg)).value,
        _dalRecipe,
      );
    });
  });

  group('RecipeOverflowController — setInRotation', () {
    test('returns true on success', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        setInRotationResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);

      final bool ok = await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .setInRotation(false);

      expect(ok, isTrue);
      expect(repository.setInRotationCalls, <({String id, bool inRotation})>[
        (id: 'recipe-1', inRotation: false),
      ]);
    });

    test('returns false on failure', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        setInRotationError: const NotFoundError('Recipe not found.'),
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);

      final bool ok = await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .setInRotation(false);

      expect(ok, isFalse);
      expect(
        container.read(recipeOverflowControllerProvider(_arg)).error,
        isA<NotFoundError>(),
      );
    });
  });

  group('RecipeOverflowController — delete', () {
    test('returns true on success and invalidates the library provider', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        deleteResult: _dalRecipe,
        result: <Recipe>[_dalRecipe],
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeLibraryControllerProvider('household-1').future);
      expect(repository.calls, hasLength(1));

      final bool ok = await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .delete();
      await container.read(recipeLibraryControllerProvider('household-1').future);

      expect(ok, isTrue);
      expect(repository.deleteCalls, <String>['recipe-1']);
      expect(repository.calls, hasLength(2));
    });

    test('returns false and preserves the AppError subtype on failure', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        deleteError: const NotFoundError('Recipe not found.'),
      );
      final ProviderContainer container = _container(repository);

      final bool ok = await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .delete();

      expect(ok, isFalse);
      expect(
        container.read(recipeOverflowControllerProvider(_arg)).error,
        isA<NotFoundError>(),
      );
    });
  });

  group('RecipeOverflowController — per-recipe scoping', () {
    test("a failed action on one recipe does not leak its error into another recipe's controller", () async {
      const RecipeDetailArg otherArg = (householdId: 'household-1', id: 'recipe-2');
      final FakeRecipeRepository repository = FakeRecipeRepository(
        favoriteError: const ForbiddenError('You are not a member of this household.'),
      );
      final ProviderContainer container = _container(repository);

      await container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .setFavorite(true);
      expect(
        container.read(recipeOverflowControllerProvider(_arg)).error,
        isA<ForbiddenError>(),
      );

      // A different recipe's controller is a clean slate — no error, no
      // action recorded — even though the fake repository would fail its
      // call too if actually invoked (it wasn't).
      expect(container.read(recipeOverflowControllerProvider(otherArg)).hasError, isFalse);
      expect(
        container.read(recipeOverflowControllerProvider(otherArg).notifier).action,
        RecipeOverflowAction.none,
      );
    });
  });

  group('RecipeOverflowController — disposal mid-mutation', () {
    test('the container disposing while a mutation is in flight does not throw', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        favoriteResult: _favoritedRecipe,
        delay: const Duration(milliseconds: 20),
      );
      // Not the shared `_container` helper: that registers `addTearDown
      // (container.dispose)`, which would double-dispose here — this test
      // disposes deliberately, mid-flight, as its own assertion.
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
      );

      final Future<bool> pending = container
          .read(recipeOverflowControllerProvider(_arg).notifier)
          .setFavorite(true);

      // The app closing (or the last widget referencing this container
      // going away) while the delayed `favoriteRecipe` call is still in
      // flight — this is a stronger version of a sheet-close-mid-mutation
      // than relying on `autoDispose`'s own keep-alive timing, which isn't
      // guaranteed to tear the notifier down synchronously within a test.
      container.dispose();

      // A sanity check, not a reproduction: `container.dispose()` in this
      // pinned riverpod version (2.6.1) turned out to make later `ref`/
      // `state` touches silent no-ops rather than throw, even with the
      // `_disposed` guards below removed — verified by temporarily
      // reverting them and re-running this suite. The `_disposed` checks
      // are kept anyway as defense-in-depth (a real bottom-sheet-close
      // disposal, via `autoDispose`'s own keep-alive timing rather than a
      // hard `container.dispose()`, was not reproducible synchronously in
      // a plain `ProviderContainer` test either way) and because relying on
      // a specific Riverpod version's forgiving disposal behavior is not a
      // property this code should depend on.
      await expectLater(pending, completes);
    });
  });

  group('RecipeOverflowController — action tracking', () {
    test('reports which action is/was running, distinguishing favorite/rotation/delete', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        favoriteResult: _favoritedRecipe,
        setInRotationResult: _dalRecipe,
        deleteResult: _dalRecipe,
      );
      final ProviderContainer container = _container(repository);
      await container.read(recipeDetailControllerProvider(_arg).future);
      final RecipeOverflowController controller = container.read(
        recipeOverflowControllerProvider(_arg).notifier,
      );

      expect(controller.action, RecipeOverflowAction.none);

      await controller.setFavorite(true);
      expect(controller.action, RecipeOverflowAction.favorite);

      await controller.setInRotation(false);
      expect(controller.action, RecipeOverflowAction.rotation);

      await controller.delete();
      expect(controller.action, RecipeOverflowAction.delete);
    });
  });
}
