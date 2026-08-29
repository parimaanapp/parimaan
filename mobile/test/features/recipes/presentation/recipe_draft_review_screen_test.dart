import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/presentation/recipe_draft_review_screen.dart';
import 'package:mobile/features/recipes/presentation/recipe_form_screen.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

void main() {
  group('RecipeDraftReviewScreen', () {
    testWidgets('is a thin wrapper that renders RecipeFormScreen in review mode', (
      WidgetTester tester,
    ) async {
      const AiRecipeDraft draft = AiRecipeDraft(title: 'Rajma Chawal');
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          recipeRepositoryProvider.overrideWithValue(FakeRecipeRepository()),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: parimaanTheme(),
            home: const RecipeDraftReviewScreen(
              householdId: 'household-1',
              draft: draft,
              sourceUrl: 'https://example.com/rajma-chawal',
            ),
          ),
        ),
      );

      final RecipeFormScreen form = tester.widget<RecipeFormScreen>(
        find.byType(RecipeFormScreen),
      );
      expect(form.householdId, 'household-1');
      expect(form.initialDraft, draft);
      expect(form.sourceUrl, 'https://example.com/rajma-chawal');
      expect(form.isReviewMode, isTrue);
    });
  });
}
