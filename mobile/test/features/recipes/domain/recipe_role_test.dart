import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';

void main() {
  test('selectable excludes unknown', () {
    expect(RecipeRole.selectable, isNot(contains(RecipeRole.unknown)));
    expect(RecipeRole.selectable.length, RecipeRole.values.length - 1);
  });

  test('sabziDal is the only member whose wireValue differs from its name', () {
    for (final RecipeRole role in RecipeRole.values) {
      if (role == RecipeRole.sabziDal) {
        expect(role.wireValue, 'sabzi_dal');
      } else {
        expect(role.wireValue, role.name);
      }
    }
  });
}
