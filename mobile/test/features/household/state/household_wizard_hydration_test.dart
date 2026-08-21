import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/cuisine_taxonomy.dart';
import 'package:mobile/features/household/domain/dietary_tag.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/household/state/household_wizard_data.dart';
import 'package:mobile/features/household/state/household_wizard_hydration.dart';

import '../../../support/household_fixtures.dart';

/// [testHousehold] with its settings replaced.
Household _withSettings(HouseholdSettings settings) => Household(
  id: testHousehold.id,
  name: testHousehold.name,
  inviteCode: testHousehold.inviteCode,
  primaryUserId: testHousehold.primaryUserId,
  subscriptionStatus: testHousehold.subscriptionStatus,
  settings: settings,
  members: testHousehold.members,
);

HouseholdSettings _settings({
  List<String> mealsEnabled = const <String>['breakfast', 'lunch'],
  String mealStructureJson =
      '{"lunch":{"carb":3,"sabzi_dal":1,"accompaniment":2}}',
  List<String> cuisineTier1 = const <String>['north_indian'],
  String cuisineTier2WeightsJson = '{"punjabi":"more"}',
  List<String> dietaryTags = const <String>['vegan'],
  List<String> allergens = const <String>['peanut'],
  List<String> skipIngredients = const <String>['brinjal'],
}) => HouseholdSettings(
  householdId: 'household-1',
  mealsEnabled: mealsEnabled,
  mealStructureJson: mealStructureJson,
  cuisineTier1: cuisineTier1,
  cuisineTier2WeightsJson: cuisineTier2WeightsJson,
  dietaryTags: dietaryTags,
  allergens: allergens,
  skipIngredients: skipIngredients,
);

void main() {
  group('wizardDataFromHousehold — round-trips the stored settings', () {
    test('decodes the enabled meals', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings()),
      );

      expect(data.mealsEnabled, <MealType>{MealType.breakfast, MealType.lunch});
    });

    test('decodes the lunch structure from the AWSJSON blob', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings()),
      );

      expect(
        data.lunchStructure,
        const LunchMealStructure(carb: 3, sabziDal: 1, accompaniment: 2),
      );
    });

    test('decodes the cuisine regions and their bias', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings()),
      );

      expect(data.regions, <CuisineRegion>{CuisineRegion.northIndian});
      expect(data.subCuisineWeights['punjabi'], CuisineBias.more);
    });

    test('decodes dietary tags, allergens and the skip list', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings()),
      );

      expect(data.dietaryTags, <DietaryTag>{DietaryTag.vegan});
      expect(data.allergens, <String>['peanut']);
      expect(data.skipIngredients, <String>['brinjal']);
    });

    test('keeps the household itself, so the edit can be submitted', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings()),
      );

      expect(data.householdId, 'household-1');
    });

    test('the bias map covers exactly the selected regions', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings(cuisineTier1: <String>['south_indian'])),
      );

      // Screen 2.5 renders straight from this map, so a stored bias for a
      // dropped region must not appear and a missing one must be defaulted.
      expect(data.subCuisineWeights.keys, isNot(contains('punjabi')));
      expect(data.subCuisineWeights.keys, contains('tamil'));
      expect(data.subCuisineWeights['tamil'], CuisineBias.normal);
    });
  });

  group('wizardDataFromHousehold — degrades rather than throws', () {
    test('drops enum names this build does not recognise', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(
          _settings(
            mealsEnabled: <String>['lunch', 'brunch_from_the_future'],
            dietaryTags: <String>['veg', 'pescatarian_from_the_future'],
            cuisineTier1: <String>['north_indian', 'martian'],
          ),
        ),
      );

      expect(data.mealsEnabled, <MealType>{MealType.lunch});
      expect(data.dietaryTags, <DietaryTag>{DietaryTag.veg});
      expect(data.regions, <CuisineRegion>{CuisineRegion.northIndian});
    });

    test('falls back to defaults on malformed mealStructure JSON', () {
      for (final String malformed in <String>[
        'not json at all',
        '[]',
        '{"lunch":"not an object"}',
        '{}',
      ]) {
        final HouseholdWizardData data = wizardDataFromHousehold(
          _withSettings(_settings(mealStructureJson: malformed)),
        );

        expect(
          data.lunchStructure,
          LunchMealStructure.defaults,
          reason: '$malformed must not make Settings unopenable',
        );
      }
    });

    test('falls back on malformed cuisine weights JSON', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings(cuisineTier2WeightsJson: '}{')),
      );

      expect(data.subCuisineWeights['punjabi'], CuisineBias.normal);
    });

    test('ignores a bias value outside the server enum', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(
          _settings(cuisineTier2WeightsJson: '{"punjabi":"loads"}'),
        ),
      );

      expect(data.subCuisineWeights['punjabi'], CuisineBias.normal);
    });

    test('clamps a slot count outside the server bounds', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(
          _settings(
            mealStructureJson:
                '{"lunch":{"carb":99,"sabzi_dal":-5,"accompaniment":1}}',
          ),
        ),
      );

      expect(data.lunchStructure.carb, LunchMealStructure.maxSlots);
      expect(data.lunchStructure.sabziDal, LunchMealStructure.minSlots);
    });

    test('an empty meals list stays empty — a real choice, not a gap', () {
      final HouseholdWizardData data = wizardDataFromHousehold(
        _withSettings(_settings(mealsEnabled: const <String>[])),
      );

      // Re-enabling three "helpfully" would overwrite a deliberate choice the
      // moment the user saved an unrelated screen.
      expect(data.mealsEnabled, isEmpty);
    });
  });
}
