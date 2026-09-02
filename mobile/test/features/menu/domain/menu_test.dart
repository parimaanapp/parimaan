import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';

import '../../../support/menu_fixtures.dart';

void main() {
  group('ProposedMenuItem.toDraft', () {
    test('converts to a NewMenuItem carrying the identical recipeId/dayOfWeek/mealSlot/slotRole, with no servingsOverride', () {
      final ProposedMenuItem proposal = ProposedMenuItem(
        recipeId: 'recipe-1',
        recipe: testMenuRecipe,
        dayOfWeek: 3,
        mealSlot: 'dinner',
        slotRole: RecipeRole.accompaniment,
      );

      final NewMenuItem draft = proposal.toDraft();

      expect(draft.recipeId, 'recipe-1');
      expect(draft.dayOfWeek, 3);
      expect(draft.mealSlot, 'dinner');
      expect(draft.slotRole, RecipeRole.accompaniment);
      expect(draft.servingsOverride, isNull);
    });
  });
}
