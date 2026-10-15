import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';

Recipe _recipe({int? prepMin, int? cookMin}) => Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: 'Toor Dal',
  servings: 4,
  prepMin: prepMin,
  cookMin: cookMin,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: false,
  isFavorite: false,
  steps: const <String>['Boil the dal.'],
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

void main() {
  group('Recipe.totalTimeMin', () {
    test('sums prepMin and cookMin when both are set', () {
      expect(_recipe(prepMin: 10, cookMin: 20).totalTimeMin, 30);
    });

    test('treats an absent prepMin as zero', () {
      expect(_recipe(cookMin: 20).totalTimeMin, 20);
    });

    test('treats an absent cookMin as zero', () {
      expect(_recipe(prepMin: 10).totalTimeMin, 10);
    });

    test('is null when both prepMin and cookMin are absent', () {
      expect(_recipe().totalTimeMin, isNull);
    });
  });

  group('Recipe equality', () {
    test('two recipes with the same fields are equal', () {
      expect(_recipe(prepMin: 10), _recipe(prepMin: 10));
    });

    test('recipes with a different ingredients-fetched-state are not equal', () {
      final Recipe fetched = Recipe(
        id: 'recipe-1',
        householdId: 'household-1',
        sourceType: RecipeSource.user,
        title: 'Toor Dal',
        servings: 4,
        dietaryTags: const <String>[],
        role: RecipeRole.sabziDal,
        inRotation: false,
        isFavorite: false,
        ingredients: const <RecipeIngredient>[],
        steps: const <String>['Boil the dal.'],
        createdAt: DateTime.utc(2026, 8, 25),
        updatedAt: DateTime.utc(2026, 8, 25),
      );
      expect(fetched, isNot(_recipe()));
    });
  });
}
