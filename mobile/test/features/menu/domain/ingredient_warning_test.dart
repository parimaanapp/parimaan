import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/domain/ingredient_warning.dart';
import 'package:mobile/features/recipes/domain/recipe_ingredient.dart';

RecipeIngredient _ingredient(String name) => RecipeIngredient(
  id: 'ingredient-$name',
  name: name,
  isStaple: false,
);

void main() {
  group('matchedIngredientWarningTerms', () {
    test('returns terms whose lowercase form is a substring of any ingredient name', () {
      final List<RecipeIngredient> ingredients = <RecipeIngredient>[
        _ingredient('Crushed Peanuts'),
        _ingredient('Salt'),
      ];

      final List<String> matches = matchedIngredientWarningTerms(
        ingredients,
        <String>['peanut', 'dairy'],
      );

      expect(matches, <String>['peanut']);
    });

    test('matching is case-insensitive on both sides', () {
      final List<RecipeIngredient> ingredients = <RecipeIngredient>[
        _ingredient('PEANUTS'),
      ];

      final List<String> matches = matchedIngredientWarningTerms(
        ingredients,
        <String>['Peanut'],
      );

      expect(matches, <String>['Peanut']);
    });

    test('returns the original term casing/text, not the lowercased form used for matching', () {
      final List<RecipeIngredient> ingredients = <RecipeIngredient>[
        _ingredient('peanuts'),
      ];

      final List<String> matches = matchedIngredientWarningTerms(
        ingredients,
        <String>['PEANUT'],
      );

      expect(matches, <String>['PEANUT']);
    });

    test('an empty or blank term never matches anything', () {
      final List<RecipeIngredient> ingredients = <RecipeIngredient>[
        _ingredient('Anything'),
      ];

      final List<String> matches = matchedIngredientWarningTerms(
        ingredients,
        <String>['', '   '],
      );

      expect(matches, isEmpty);
    });

    test('no ingredients means no matches, never an error', () {
      final List<String> matches = matchedIngredientWarningTerms(
        const <RecipeIngredient>[],
        <String>['peanut'],
      );

      expect(matches, isEmpty);
    });

    test('no terms means no matches', () {
      final List<RecipeIngredient> ingredients = <RecipeIngredient>[
        _ingredient('Peanuts'),
      ];

      final List<String> matches = matchedIngredientWarningTerms(
        ingredients,
        const <String>[],
      );

      expect(matches, isEmpty);
    });

    test('preserves the caller\'s own term order for multiple matches', () {
      final List<RecipeIngredient> ingredients = <RecipeIngredient>[
        _ingredient('Peanuts'),
        _ingredient('Milk'),
      ];

      final List<String> matches = matchedIngredientWarningTerms(
        ingredients,
        <String>['dairy', 'milk', 'peanut'],
      );

      expect(matches, <String>['milk', 'peanut']);
    });
  });
}
