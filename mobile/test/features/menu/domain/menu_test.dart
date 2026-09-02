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

  group('UnfilledSlot equality', () {
    test('two UnfilledSlots with the same fields are equal, distinct instances', () {
      const UnfilledSlot a = UnfilledSlot(dayOfWeek: 0, mealSlot: 'lunch', slotRole: RecipeRole.carb);
      const UnfilledSlot b = UnfilledSlot(dayOfWeek: 0, mealSlot: 'lunch', slotRole: RecipeRole.carb);
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a differing field breaks equality', () {
      const UnfilledSlot a = UnfilledSlot(dayOfWeek: 0, mealSlot: 'lunch', slotRole: RecipeRole.carb);
      const UnfilledSlot b = UnfilledSlot(dayOfWeek: 1, mealSlot: 'lunch', slotRole: RecipeRole.carb);
      expect(a, isNot(b));
    });
  });

  group('ProposedMenuItem equality', () {
    test('two ProposedMenuItems with the same fields (including the same Recipe) are equal', () {
      final ProposedMenuItem a = ProposedMenuItem(
        recipeId: 'recipe-1',
        recipe: testMenuRecipe,
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.carb,
      );
      final ProposedMenuItem b = ProposedMenuItem(
        recipeId: 'recipe-1',
        recipe: testMenuRecipe,
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.carb,
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a differing recipeId breaks equality', () {
      final ProposedMenuItem a = ProposedMenuItem(
        recipeId: 'recipe-1',
        recipe: testMenuRecipe,
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.carb,
      );
      final ProposedMenuItem b = ProposedMenuItem(
        recipeId: 'recipe-2',
        recipe: testMenuRecipe,
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.carb,
      );
      expect(a, isNot(b));
    });
  });

  group('AutoFillPreviewResult equality', () {
    test('two results with the same items (order-sensitive)/filledCount/unfilledSlots are equal', () {
      final ProposedMenuItem item = ProposedMenuItem(
        recipeId: 'recipe-1',
        recipe: testMenuRecipe,
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.carb,
      );
      const UnfilledSlot slot = UnfilledSlot(dayOfWeek: 1, mealSlot: 'lunch', slotRole: RecipeRole.sabziDal);

      final AutoFillPreviewResult a = AutoFillPreviewResult(
        items: <ProposedMenuItem>[item],
        filledCount: 1,
        unfilledSlots: const <UnfilledSlot>[slot],
      );
      final AutoFillPreviewResult b = AutoFillPreviewResult(
        items: <ProposedMenuItem>[item],
        filledCount: 1,
        unfilledSlots: const <UnfilledSlot>[slot],
      );

      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a different item order breaks equality — order is part of the value', () {
      final ProposedMenuItem first = ProposedMenuItem(
        recipeId: 'recipe-1',
        recipe: testMenuRecipe,
        dayOfWeek: 0,
        mealSlot: 'lunch',
        slotRole: RecipeRole.carb,
      );
      final ProposedMenuItem second = ProposedMenuItem(
        recipeId: 'recipe-2',
        recipe: testMenuRecipe,
        dayOfWeek: 1,
        mealSlot: 'lunch',
        slotRole: RecipeRole.carb,
      );

      final AutoFillPreviewResult a = AutoFillPreviewResult(
        items: <ProposedMenuItem>[first, second],
        filledCount: 2,
        unfilledSlots: const <UnfilledSlot>[],
      );
      final AutoFillPreviewResult b = AutoFillPreviewResult(
        items: <ProposedMenuItem>[second, first],
        filledCount: 2,
        unfilledSlots: const <UnfilledSlot>[],
      );

      expect(a, isNot(b));
    });
  });

  group('AutoFillResult equality', () {
    test('two results with the same menu/filledCount/unfilledSlots are equal', () {
      final AutoFillResult a = AutoFillResult(
        menu: testEmptyMenu,
        filledCount: 0,
        unfilledSlots: const <UnfilledSlot>[],
      );
      final AutoFillResult b = AutoFillResult(
        menu: testEmptyMenu,
        filledCount: 0,
        unfilledSlots: const <UnfilledSlot>[],
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a differing filledCount breaks equality', () {
      final AutoFillResult a = AutoFillResult(
        menu: testEmptyMenu,
        filledCount: 0,
        unfilledSlots: const <UnfilledSlot>[],
      );
      final AutoFillResult b = AutoFillResult(
        menu: testEmptyMenu,
        filledCount: 1,
        unfilledSlots: const <UnfilledSlot>[],
      );
      expect(a, isNot(b));
    });
  });
}
