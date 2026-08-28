import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/ai_recipe_draft_mapper.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/shared/graphql/__generated__/schema.schema.gql.dart';
import 'package:mobile/shared/graphql/operations/__generated__/recipe_draft_fields.data.gql.dart';

GRecipeDraftFieldsData _data({
  GCuisineTier1? cuisineTier1,
  GRecipeRole? role,
  String? sourceUrl,
  List<GRecipeDraftFieldsData_ingredients>? ingredients,
  List<String>? warnings,
}) => GRecipeDraftFieldsData(
  (GRecipeDraftFieldsDataBuilder b) => b
    ..title = 'Rajma Chawal'
    ..description = 'A comforting kidney bean curry.'
    ..servings = 4
    ..prepMin = 15
    ..cookMin = 30
    ..cuisineTier1 = cuisineTier1
    ..cuisineTier2 = 'punjabi'
    ..dietaryTags.addAll(<GDietaryTag>[GDietaryTag.veg])
    ..role = role
    ..ingredients.addAll(
      ingredients ??
          <GRecipeDraftFieldsData_ingredients>[
            GRecipeDraftFieldsData_ingredients(
              (GRecipeDraftFieldsData_ingredientsBuilder ib) => ib
                ..raw = '1 cup rajma'
                ..name = 'Rajma'
                ..quantity = 1
                ..unit = 'cup'
                ..notes = null,
            ),
          ],
    )
    ..steps.addAll(<String>['Soak the rajma overnight.'])
    ..sourceUrl = sourceUrl
    ..warnings.addAll(warnings ?? const <String>[]),
);

void main() {
  group('aiRecipeDraftFromGraphQL', () {
    test('maps every field through', () {
      final result = aiRecipeDraftFromGraphQL(
        _data(
          cuisineTier1: GCuisineTier1.north_indian,
          role: GRecipeRole.sabzi_dal,
          sourceUrl: 'https://example.com/rajma-chawal',
          warnings: <String>['Could not determine cuisineTier2.'],
        ),
      );

      expect(result.title, 'Rajma Chawal');
      expect(result.description, 'A comforting kidney bean curry.');
      expect(result.servings, 4);
      expect(result.prepMin, 15);
      expect(result.cookMin, 30);
      expect(result.cuisineTier1, 'north_indian');
      expect(result.cuisineTier2, 'punjabi');
      expect(result.dietaryTags, <String>['veg']);
      expect(result.role, RecipeRole.sabziDal);
      expect(result.ingredients, hasLength(1));
      expect(result.ingredients.first.raw, '1 cup rajma');
      expect(result.ingredients.first.name, 'Rajma');
      expect(result.ingredients.first.quantity, 1);
      expect(result.ingredients.first.unit, 'cup');
      expect(result.steps, <String>['Soak the rajma overnight.']);
      expect(result.sourceUrl, 'https://example.com/rajma-chawal');
      expect(result.warnings, <String>['Could not determine cuisineTier2.']);
    });

    test('maps a null cuisineTier1 through as null', () {
      final result = aiRecipeDraftFromGraphQL(_data());
      expect(result.cuisineTier1, isNull);
    });

    test('maps a null role through as null, not RecipeRole.unknown', () {
      final result = aiRecipeDraftFromGraphQL(_data());
      expect(result.role, isNull);
    });

    test('maps sourceUrl through as null for a freeform (non-URL) parse', () {
      final result = aiRecipeDraftFromGraphQL(_data());
      expect(result.sourceUrl, isNull);
    });

    test('maps a zero-ingredient draft to an empty (not null) list', () {
      final result = aiRecipeDraftFromGraphQL(
        _data(ingredients: <GRecipeDraftFieldsData_ingredients>[]),
      );
      expect(result.ingredients, isNotNull);
      expect(result.ingredients, isEmpty);
    });

    test('maps a warnings-free draft to an empty (not null) list', () {
      final result = aiRecipeDraftFromGraphQL(_data());
      expect(result.warnings, isNotNull);
      expect(result.warnings, isEmpty);
    });
  });
}
