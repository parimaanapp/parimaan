import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/recipe_validation.dart';

void main() {
  group('validateRecipeTitle', () {
    test('rejects an empty title', () {
      expect(validateRecipeTitle(''), isNotNull);
      expect(validateRecipeTitle('   '), isNotNull);
    });

    test('rejects a title over the max length', () {
      expect(validateRecipeTitle('a' * (maxRecipeTitleLength + 1)), isNotNull);
    });

    test('accepts a title at the max length', () {
      expect(validateRecipeTitle('a' * maxRecipeTitleLength), isNull);
    });

    test('accepts a normal title', () {
      expect(validateRecipeTitle('Toor Dal'), isNull);
    });
  });

  group('validateRecipeDescription', () {
    test('null is valid — not set', () {
      expect(validateRecipeDescription(null), isNull);
    });

    test('rejects a description over the max length', () {
      expect(
        validateRecipeDescription('a' * (maxRecipeDescriptionLength + 1)),
        isNotNull,
      );
    });
  });

  group('validateRecipeServings', () {
    test('null is valid — not set', () {
      expect(validateRecipeServings(null), isNull);
    });

    test('rejects zero and negative servings', () {
      expect(validateRecipeServings(0), isNotNull);
      expect(validateRecipeServings(-1), isNotNull);
    });

    test('accepts a positive value', () {
      expect(validateRecipeServings(4), isNull);
    });
  });

  group('validateRecipeMinutes', () {
    test('null is valid — not set', () {
      expect(validateRecipeMinutes(null, 'prepMin'), isNull);
    });

    test('rejects a negative value', () {
      expect(validateRecipeMinutes(-1, 'prepMin'), isNotNull);
    });

    test('accepts zero — an instant step is valid', () {
      expect(validateRecipeMinutes(0, 'cookMin'), isNull);
    });
  });

  group('validateRecipeIngredientName', () {
    test('rejects an empty name', () {
      expect(validateRecipeIngredientName(''), isNotNull);
    });

    test('rejects a name over the max length', () {
      expect(
        validateRecipeIngredientName('a' * (maxRecipeIngredientNameLength + 1)),
        isNotNull,
      );
    });

    test('accepts a normal name', () {
      expect(validateRecipeIngredientName('Toor dal'), isNull);
    });
  });

  group('validateRecipeIngredientQuantity', () {
    test('null is valid — not set', () {
      expect(validateRecipeIngredientQuantity(null), isNull);
    });

    test('rejects a negative quantity', () {
      expect(validateRecipeIngredientQuantity(-1), isNotNull);
    });

    test('accepts zero', () {
      expect(validateRecipeIngredientQuantity(0), isNull);
    });
  });

  group('validateRecipeStep', () {
    test('an empty step is valid — matches the server, which has no min length', () {
      expect(validateRecipeStep(''), isNull);
    });

    test('rejects a step over the max length', () {
      expect(validateRecipeStep('a' * (maxRecipeStepLength + 1)), isNotNull);
    });
  });
}
