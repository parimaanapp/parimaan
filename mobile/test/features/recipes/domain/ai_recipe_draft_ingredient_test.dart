import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft_ingredient.dart';

const _base = AiRecipeDraftIngredient(
  raw: '1 cup rajma',
  name: 'Rajma',
  quantity: 1,
  unit: 'cup',
  notes: null,
);

void main() {
  group('AiRecipeDraftIngredient equality', () {
    test('two ingredients with identical fields are equal, with equal hashCodes', () {
      const other = AiRecipeDraftIngredient(
        raw: '1 cup rajma',
        name: 'Rajma',
        quantity: 1,
        unit: 'cup',
        notes: null,
      );
      expect(_base, other);
      expect(_base.hashCode, other.hashCode);
    });

    test('differing only in quantity is not equal', () {
      expect(_base, isNot(const AiRecipeDraftIngredient(raw: '1 cup rajma', name: 'Rajma', quantity: 2, unit: 'cup')));
    });

    test('differing only in unit is not equal', () {
      expect(_base, isNot(const AiRecipeDraftIngredient(raw: '1 cup rajma', name: 'Rajma', quantity: 1, unit: 'g')));
    });

    test('differing only in notes is not equal', () {
      expect(
        _base,
        isNot(
          const AiRecipeDraftIngredient(
            raw: '1 cup rajma',
            name: 'Rajma',
            quantity: 1,
            unit: 'cup',
            notes: 'soaked overnight',
          ),
        ),
      );
    });

    test('differing only in raw is not equal', () {
      expect(
        _base,
        isNot(const AiRecipeDraftIngredient(raw: '1 cup of rajma', name: 'Rajma', quantity: 1, unit: 'cup')),
      );
    });
  });
}
