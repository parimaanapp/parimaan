import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_mapper.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/shared/graphql/__generated__/schema.schema.gql.dart';
import 'package:mobile/shared/graphql/operations/__generated__/recipes.data.gql.dart';

GRecipesData_recipes _data({
  GCuisineTier1? cuisineTier1,
  GRecipeSource sourceType = GRecipeSource.user,
  GRecipeRole role = GRecipeRole.sabzi_dal,
}) => GRecipesData_recipes(
  (GRecipesData_recipesBuilder b) => b
    ..id = 'recipe-1'
    ..householdId = 'household-1'
    ..sourceType = sourceType
    ..sourceUrl = null
    ..title = 'Toor Dal'
    ..description = null
    ..servings = 4
    ..prepMin = 10
    ..cookMin = 20
    ..cuisineTier1 = cuisineTier1
    ..cuisineTier2 = null
    ..dietaryTags.addAll(<GDietaryTag>[GDietaryTag.veg])
    ..role = role
    ..inRotation = true
    ..isFavorite = false
    ..steps.addAll(<String>['Boil the dal.'])
    ..createdAt = DateTime.utc(2026, 8, 25, 10)
    ..updatedAt = DateTime.utc(2026, 8, 25, 11),
);

void main() {
  group('recipeFromGraphQL', () {
    test('maps every field through', () {
      final result = recipeFromGraphQL(
        _data(cuisineTier1: GCuisineTier1.north_indian),
      );

      expect(result.id, 'recipe-1');
      expect(result.householdId, 'household-1');
      expect(result.sourceType, RecipeSource.user);
      expect(result.title, 'Toor Dal');
      expect(result.servings, 4);
      expect(result.prepMin, 10);
      expect(result.cookMin, 20);
      expect(result.cuisineTier1, 'north_indian');
      expect(result.dietaryTags, <String>['veg']);
      expect(result.role, RecipeRole.sabziDal);
      expect(result.inRotation, isTrue);
      expect(result.isFavorite, isFalse);
      expect(result.steps, <String>['Boil the dal.']);
      expect(result.createdAt, DateTime.utc(2026, 8, 25, 10));
      expect(result.updatedAt, DateTime.utc(2026, 8, 25, 11));
      expect(result.ingredients, isNull);
    });

    test('maps a null cuisineTier1 through as null', () {
      final result = recipeFromGraphQL(_data());
      expect(result.cuisineTier1, isNull);
    });

    test('maps an unrecognised role to RecipeRole.unknown', () {
      final result = recipeFromGraphQL(
        _data(role: GRecipeRole.gUnknownEnumValue),
      );
      expect(result.role, RecipeRole.unknown);
    });

    test('maps an unrecognised source to RecipeSource.unknown', () {
      final result = recipeFromGraphQL(
        _data(sourceType: GRecipeSource.gUnknownEnumValue),
      );
      expect(result.sourceType, RecipeSource.unknown);
    });
  });

  group('recipeRoleToGraphQL', () {
    test('maps every selectable role to its wire enum', () {
      for (final RecipeRole role in RecipeRole.selectable) {
        expect(recipeRoleToGraphQL(role).name, role.wireValue);
      }
    });

    test('throws for RecipeRole.unknown, which has no wire value', () {
      expect(
        () => recipeRoleToGraphQL(RecipeRole.unknown),
        throwsArgumentError,
      );
    });
  });
}
