import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/cuisine_taxonomy.dart';
import 'package:mobile/features/household/domain/dietary_tag.dart';
import 'package:mobile/features/household/domain/household_settings_patch.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/domain/meal_type.dart';

void main() {
  group('DietaryTag', () {
    test('wire values match shared/schema.graphql exactly', () {
      expect(
        DietaryTag.values.map((DietaryTag t) => t.wireValue).toList(),
        <String>[
          'veg',
          'vegan',
          'jain',
          'eggetarian',
          'gluten_free',
          'dairy_free',
        ],
      );
    });

    test('display labels are the wireframe chip copy, not the enum names', () {
      expect(DietaryTag.veg.displayLabel, 'veg');
      expect(DietaryTag.vegan.displayLabel, 'vegan');
      expect(DietaryTag.jain.displayLabel, 'jain');
      expect(DietaryTag.eggetarian.displayLabel, 'egg-friendly');
      expect(DietaryTag.glutenFree.displayLabel, 'GF');
      expect(DietaryTag.dairyFree.displayLabel, 'dairy-free');
    });

    test('the wireframe pre-selects veg and egg-friendly', () {
      expect(defaultDietaryTags, <DietaryTag>{
        DietaryTag.veg,
        DietaryTag.eggetarian,
      });
    });
  });

  group('HouseholdSettingsPatch — partial-patch semantics', () {
    test('a null field means "absent", i.e. leave unchanged', () {
      const HouseholdSettingsPatch patch = HouseholdSettingsPatch(
        mealsEnabled: <MealType>[MealType.lunch],
      );

      expect(patch.mealsEnabled, <MealType>[MealType.lunch]);
      expect(patch.mealStructureJson, isNull);
      expect(patch.cuisineTier1, isNull);
      expect(patch.cuisineTier2WeightsJson, isNull);
      expect(patch.dietaryTags, isNull);
      expect(patch.allergens, isNull);
      expect(patch.skipIngredients, isNull);
    });

    test('reports the field count it will actually send', () {
      expect(
        const HouseholdSettingsPatch(mealsEnabled: <MealType>[MealType.lunch])
            .fieldCount,
        1,
      );
      expect(
        const HouseholdSettingsPatch(
          allergens: <String>['peanut'],
          skipIngredients: <String>['brinjal'],
          dietaryTags: <DietaryTag>[DietaryTag.veg],
        ).fieldCount,
        3,
      );
    });

    test('an all-absent patch is a programming error, caught by assert', () {
      expect(() => HouseholdSettingsPatch(), throwsA(isA<AssertionError>()));
    });
  });

  group('HouseholdSettingsPatch — per-step factories', () {
    test('meals sends only mealsEnabled', () {
      final HouseholdSettingsPatch patch = HouseholdSettingsPatch.meals(
        <MealType>{MealType.breakfast, MealType.dinner},
      );

      expect(patch.fieldCount, 1);
      expect(patch.mealsEnabled, <MealType>[
        MealType.breakfast,
        MealType.dinner,
      ]);
    });

    test('meals emits schema order, not selection order', () {
      final HouseholdSettingsPatch patch = HouseholdSettingsPatch.meals(
        <MealType>{MealType.dinner, MealType.breakfast},
      );

      expect(patch.mealsEnabled, <MealType>[
        MealType.breakfast,
        MealType.dinner,
      ]);
    });

    test('lunchStructure sends only the lunch-keyed mealStructure JSON', () {
      final HouseholdSettingsPatch patch =
          HouseholdSettingsPatch.lunchStructure(LunchMealStructure.defaults);

      expect(patch.fieldCount, 1);
      expect(
        patch.mealStructureJson,
        '{"lunch":{"carb":2,"sabzi_dal":2,"accompaniment":1}}',
      );
    });

    test('cuisineRegions sends only cuisineTier1, in schema order', () {
      final HouseholdSettingsPatch patch =
          HouseholdSettingsPatch.cuisineRegions(<CuisineRegion>{
            CuisineRegion.continental,
            CuisineRegion.northIndian,
          });

      expect(patch.fieldCount, 1);
      expect(patch.cuisineTier1, <CuisineRegion>[
        CuisineRegion.northIndian,
        CuisineRegion.continental,
      ]);
    });

    test('cuisineWeights sends only the encoded AWSJSON string', () {
      final HouseholdSettingsPatch patch =
          HouseholdSettingsPatch.cuisineWeights(<String, CuisineBias>{
            'punjabi': CuisineBias.more,
          });

      expect(patch.fieldCount, 1);
      expect(patch.cuisineTier2WeightsJson, '{"punjabi":"more"}');
    });

    test('dietary sends the three fields the last wizard step owns', () {
      final HouseholdSettingsPatch patch = HouseholdSettingsPatch.dietary(
        tags: <DietaryTag>{DietaryTag.veg},
        allergens: <String>['peanut'],
        skipIngredients: <String>['mustard oil'],
      );

      expect(patch.fieldCount, 3);
      expect(patch.dietaryTags, <DietaryTag>[DietaryTag.veg]);
      expect(patch.allergens, <String>['peanut']);
      expect(patch.skipIngredients, <String>['mustard oil']);
    });

    test('dietary with no tags sends an empty list, not an absent field', () {
      final HouseholdSettingsPatch patch = HouseholdSettingsPatch.dietary(
        tags: const <DietaryTag>{},
        allergens: const <String>[],
        skipIngredients: const <String>[],
      );

      expect(patch.fieldCount, 3);
      expect(patch.dietaryTags, isEmpty);
    });
  });
}
