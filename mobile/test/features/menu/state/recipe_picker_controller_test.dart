import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/state/recipe_picker_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_recipe_repository.dart';
import '../../../support/menu_fixtures.dart';

ProviderContainer _container(FakeRecipeRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('RecipePickerController', () {
    test('fetches recipes filtered to the key\'s own slotRole', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[testMenuRecipe],
      );
      final ProviderContainer container = _container(repository);
      final RecipePickerKey key = (
        householdId: 'household-1',
        slotRole: RecipeRole.sabziDal,
      );

      final List<Recipe> result = await container.read(
        recipePickerControllerProvider(key).future,
      );

      expect(result, <Recipe>[testMenuRecipe]);
      expect(repository.calls, hasLength(1));
      expect(repository.calls.single.householdId, 'household-1');
      expect(repository.calls.single.role, RecipeRole.sabziDal);
      // No favorite/rotation filter applied — ordering (server-side) is
      // what surfaces favorites/rotation first, not a hard filter here.
      expect(repository.calls.single.isFavorite, isNull);
      expect(repository.calls.single.inRotation, isNull);
    });

    test('a different slotRole is an independent cache from the same household', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[testMenuRecipe],
      );
      final ProviderContainer container = _container(repository);

      await container.read(
        recipePickerControllerProvider((
          householdId: 'household-1',
          slotRole: RecipeRole.carb,
        )).future,
      );
      await container.read(
        recipePickerControllerProvider((
          householdId: 'household-1',
          slotRole: RecipeRole.sabziDal,
        )).future,
      );

      expect(repository.calls, hasLength(2));
      expect(repository.calls[0].role, RecipeRole.carb);
      expect(repository.calls[1].role, RecipeRole.sabziDal);
    });

    test('a fetch failure lands in state with its concrete AppError subtype', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        error: const ForbiddenError('Not a member.'),
      );
      final ProviderContainer container = _container(repository);
      final RecipePickerKey key = (
        householdId: 'household-1',
        slotRole: RecipeRole.carb,
      );

      await expectLater(
        container.read(recipePickerControllerProvider(key).future),
        throwsA(isA<ForbiddenError>()),
      );
    });

    test('an empty result is a real, meaningful state — not an error', () async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: const <Recipe>[],
      );
      final ProviderContainer container = _container(repository);
      final RecipePickerKey key = (
        householdId: 'household-1',
        slotRole: RecipeRole.carb,
      );

      final List<Recipe> result = await container.read(
        recipePickerControllerProvider(key).future,
      );
      expect(result, isEmpty);
    });
  });
}
