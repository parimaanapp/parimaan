import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/meal_type.dart';

void main() {
  group('wizardMealTypes — the create wizard\'s three toggles', () {
    test('is exactly Breakfast, Lunch, Dinner, in that order', () {
      expect(wizardMealTypes, <MealType>[
        MealType.breakfast,
        MealType.lunch,
        MealType.dinner,
      ]);
    });

    test('does not include Snacks', () {
      expect(wizardMealTypes, isNot(contains(MealType.snacks)));
    });
  });

  group('editMealTypes — the Settings "Meals to plan" row (W13 S3)', () {
    test('is all four MealType.values, schema order', () {
      expect(editMealTypes, MealType.values);
      expect(editMealTypes, hasLength(4));
    });

    test('includes Snacks — the gap this slice closes', () {
      expect(editMealTypes, contains(MealType.snacks));
    });
  });

  group('meal_type.dart doc comment — a review check (W13 S3)', () {
    // The doc comment above `wizardMealTypes` used to promise an edit path
    // that did not exist yet ("Snacks remains reachable through the
    // Settings → Meal structure screen ... which is a later slice"). This
    // slice is the one that makes it true, and the comment must say so
    // rather than keep pointing at a path that was never built (the
    // Settings screen this promise names is "Meal structure", not "Meals to
    // plan" — a second inaccuracy the fix corrects at the same time).
    test('no longer claims Snacks is reachable via "Meal structure"', () {
      final String source = File(
        'lib/features/household/domain/meal_type.dart',
      ).readAsStringSync();

      expect(
        source.contains(
          'Snacks remains reachable through the Settings → Meal structure '
          'screen',
        ),
        isFalse,
        reason: 'the stale forward-reference must be gone, not merely '
            'true again in prose',
      );
      expect(
        source.contains('W13 S3'),
        isTrue,
        reason: 'the corrected doc comment must cite the slice that closed '
            'the gap',
      );
    });
  });
}
