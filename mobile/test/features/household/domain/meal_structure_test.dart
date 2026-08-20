import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/domain/meal_type.dart';

void main() {
  group('MealType', () {
    test('wire values match shared/schema.graphql exactly', () {
      expect(
        MealType.values.map((MealType t) => t.wireValue).toList(),
        <String>['breakfast', 'lunch', 'snacks', 'dinner'],
      );
    });

    test('the wizard offers the three meals the wireframe draws', () {
      expect(wizardMealTypes, <MealType>[
        MealType.breakfast,
        MealType.lunch,
        MealType.dinner,
      ]);
      expect(wizardMealTypes, isNot(contains(MealType.snacks)));
    });

    test('every wizard meal has display copy from the wireframe', () {
      expect(MealType.breakfast.displayLabel, 'Breakfast');
      expect(
        MealType.breakfast.description,
        '1 recipe per day (e.g. Poha, Idli)',
      );
      expect(MealType.lunch.displayLabel, 'Lunch');
      expect(MealType.lunch.description, 'Up to 3 types × 3 each');
      expect(MealType.dinner.displayLabel, 'Dinner');
      expect(MealType.dinner.description, 'Same structure as lunch');
    });
  });

  group('MealSlot', () {
    test('wire keys match the server mealStructure entry schema', () {
      expect(MealSlot.values.map((MealSlot s) => s.wireKey).toList(), <String>[
        'carb',
        'sabzi_dal',
        'accompaniment',
      ]);
    });

    test('display labels come from the wireframe', () {
      expect(MealSlot.carb.displayLabel, 'Carb');
      expect(MealSlot.sabziDal.displayLabel, 'Sabzi · Dal');
      expect(MealSlot.accompaniment.displayLabel, 'Accompaniment');
    });
  });

  group('LunchMealStructure defaults', () {
    test('match the wireframe: carb 2, sabzi·dal 2, accompaniment 1', () {
      expect(LunchMealStructure.defaults.countFor(MealSlot.carb), 2);
      expect(LunchMealStructure.defaults.countFor(MealSlot.sabziDal), 2);
      expect(LunchMealStructure.defaults.countFor(MealSlot.accompaniment), 1);
    });

    test('the bounds mirror the server 0..10 validation', () {
      expect(LunchMealStructure.minSlots, 0);
      expect(LunchMealStructure.maxSlots, 10);
    });
  });

  group('LunchMealStructure.withCount', () {
    test('returns a new value and never mutates the receiver', () {
      const LunchMealStructure original = LunchMealStructure.defaults;

      final LunchMealStructure updated = original.withCount(MealSlot.carb, 5);

      expect(updated.countFor(MealSlot.carb), 5);
      expect(original.countFor(MealSlot.carb), 2);
      expect(identical(original, updated), isFalse);
    });

    test('clamps below the minimum rather than sending an invalid patch', () {
      expect(
        LunchMealStructure.defaults
            .withCount(MealSlot.carb, -3)
            .countFor(MealSlot.carb),
        0,
      );
    });

    test('clamps above the maximum', () {
      expect(
        LunchMealStructure.defaults
            .withCount(MealSlot.accompaniment, 99)
            .countFor(MealSlot.accompaniment),
        10,
      );
    });

    test('leaves the other two slots untouched', () {
      final LunchMealStructure updated = LunchMealStructure.defaults.withCount(
        MealSlot.sabziDal,
        7,
      );

      expect(updated.countFor(MealSlot.carb), 2);
      expect(updated.countFor(MealSlot.accompaniment), 1);
    });
  });

  group('LunchMealStructure serialization', () {
    test('toJson nests the three slots under the lunch meal-type key', () {
      expect(LunchMealStructure.defaults.toJson(), <String, Object?>{
        'lunch': <String, Object?>{
          'carb': 2,
          'sabzi_dal': 2,
          'accompaniment': 1,
        },
      });
    });

    test('carries no dinner key — this screen is lunch only', () {
      expect(LunchMealStructure.defaults.toJson().keys, <String>['lunch']);
    });

    test('toWireJson is a JSON string, because AWSJSON is a string', () {
      final String wire = LunchMealStructure.defaults.toWireJson();

      expect(wire, isA<String>());
      expect(jsonDecode(wire), <String, Object?>{
        'lunch': <String, Object?>{
          'carb': 2,
          'sabzi_dal': 2,
          'accompaniment': 1,
        },
      });
    });

    test('serializes edited counts', () {
      final String wire = LunchMealStructure.defaults
          .withCount(MealSlot.carb, 0)
          .withCount(MealSlot.accompaniment, 10)
          .toWireJson();

      expect(
        (jsonDecode(wire) as Map<String, dynamic>)['lunch'],
        <String, Object?>{'carb': 0, 'sabzi_dal': 2, 'accompaniment': 10},
      );
    });
  });

  group('LunchMealStructure value semantics', () {
    test('equal counts compare equal and hash equal', () {
      const LunchMealStructure a = LunchMealStructure(
        carb: 3,
        sabziDal: 1,
        accompaniment: 0,
      );
      const LunchMealStructure b = LunchMealStructure(
        carb: 3,
        sabziDal: 1,
        accompaniment: 0,
      );

      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a differing slot compares unequal', () {
      expect(
        const LunchMealStructure(carb: 3, sabziDal: 1, accompaniment: 0),
        isNot(const LunchMealStructure(carb: 3, sabziDal: 2, accompaniment: 0)),
      );
    });
  });
}
