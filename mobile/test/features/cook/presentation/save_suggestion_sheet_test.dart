import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/domain/cook_suggestion.dart';
import 'package:mobile/features/cook/presentation/save_suggestion_sheet.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';

import 'package:mobile/features/recipes/domain/ai_recipe_draft_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/domain/recipe_source_attribution.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/storage/app_database.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

const String _householdId = 'household-1';

CookSuggestion _suggestion() => CookSuggestion(
  id: 'sugg-1',
  draft: const AiRecipeDraft(
    title: 'Aloo Jeera',
    servings: 4,
    cookMin: 25,
    role: RecipeRole.sabziDal,
    ingredients: <AiRecipeDraftIngredient>[
      AiRecipeDraftIngredient(
        raw: '4 pcs potato',
        name: 'Potato',
        quantity: 4,
        unit: 'pcs',
      ),
    ],
    steps: <String>['Boil the potato.'],
  ),
  ingredientMatches: const <CookIngredientMatch>[],
  have: const <String>['Potato'],
  missing: const <String>[],
);

Recipe _recipe(String id) => Recipe(
  id: id,
  householdId: _householdId,
  sourceType: RecipeSource.ai,
  title: 'Aloo Jeera',
  servings: 4,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: true,
  isFavorite: false,
  steps: const <String>['Boil the potato.'],
  createdAt: DateTime.utc(2026, 9, 29),
  updatedAt: DateTime.utc(2026, 9, 29),
);

Future<
  ({
    ProviderContainer container,
    FakeRecipeRepository repository,
    String? result,
    int editTaps,
  })
>
_open(WidgetTester tester, {CookSuggestion? suggestion}) async {
  final FakeRecipeRepository repository = FakeRecipeRepository();
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      recipeRepositoryProvider.overrideWithValue(repository),
      appDatabaseProvider.overrideWithValue(
        AppDatabase(NativeDatabase.memory()),
      ),
    ],
  );
  addTearDown(container.dispose);
  int editTaps = 0;
  String? result;
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                result = await showSaveSuggestionSheet(
                  context,
                  householdId: _householdId,
                  suggestion: suggestion ?? _suggestion(),
                  onEditBeforeSaving: () => editTaps++,
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return (
    container: container,
    repository: repository,
    result: result,
    editTaps: editTaps,
  );
}

void main() {
  group('showSaveSuggestionSheet', () {
    testWidgets(
      'states that it joins rotation, and Save starts disabled while the role is only proposed',
      (WidgetTester tester) async {
        await _open(tester);

        expect(find.textContaining('rotation'), findsOneWidget);
        expect(
          tester
              .widget<PButton>(find.byKey(SaveSuggestionSheet.saveButtonKey))
              .onPressed,
          isNull,
        );
      },
    );

    testWidgets('tapping the proposed role chip confirms it and enables Save', (
      WidgetTester tester,
    ) async {
      await _open(tester);

      await tester.tap(
        find.byKey(SaveSuggestionSheet.roleChipKey(RecipeRole.sabziDal)),
      );
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<PButton>(find.byKey(SaveSuggestionSheet.saveButtonKey))
            .onPressed,
        isNotNull,
      );
    });

    testWidgets(
      'tapping a different role chip changes the selection and enables Save',
      (WidgetTester tester) async {
        await _open(tester);

        await tester.tap(
          find.byKey(SaveSuggestionSheet.roleChipKey(RecipeRole.snack)),
        );
        await tester.pumpAndSettle();

        expect(
          tester
              .widget<PChip>(
                find.byKey(SaveSuggestionSheet.roleChipKey(RecipeRole.snack)),
              )
              .selected,
          isTrue,
        );
        expect(
          tester
              .widget<PButton>(find.byKey(SaveSuggestionSheet.saveButtonKey))
              .onPressed,
          isNotNull,
        );
      },
    );

    testWidgets(
      'Save sends the unedited draft with sourceType ai and inRotation true, and pops with the new recipe id',
      (WidgetTester tester) async {
        final opened = await _open(tester);
        opened.repository.createResult = _recipe('recipe-9');

        await tester.tap(
          find.byKey(SaveSuggestionSheet.roleChipKey(RecipeRole.sabziDal)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(SaveSuggestionSheet.saveButtonKey));
        await tester.pumpAndSettle();

        expect(opened.repository.createCalls, hasLength(1));
        final call = opened.repository.createCalls.single;
        expect(call.householdId, _householdId);
        expect(call.source, isA<RecipeSourceAttribution>());
        expect(
          (call.source as RecipeSourceAttribution).sourceType,
          RecipeSource.ai,
        );
        expect((call.source as RecipeSourceAttribution).sourceUrl, isNull);
        expect(call.draft.inRotation, isTrue);
        expect(call.draft.role, RecipeRole.sabziDal);
        expect(call.draft.title, 'Aloo Jeera');
        expect(call.draft.ingredients.single.name, 'Potato');
        expect(call.draft.steps, <String>['Boil the potato.']);
      },
    );

    testWidgets(
      'a successful save closes the sheet with the new recipe\'s id',
      (WidgetTester tester) async {
        final opened = await _open(tester);
        opened.repository.createResult = _recipe('recipe-9');

        await tester.tap(
          find.byKey(SaveSuggestionSheet.roleChipKey(RecipeRole.sabziDal)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(SaveSuggestionSheet.saveButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(SaveSuggestionSheet), findsNothing);
      },
    );

    testWidgets(
      '"Edit before saving" closes the sheet and calls onEditBeforeSaving, without saving anything',
      (WidgetTester tester) async {
        final opened = await _open(tester);

        await tester.tap(find.text('Edit before saving'));
        await tester.pumpAndSettle();

        expect(opened.repository.createCalls, isEmpty);
        expect(find.byType(SaveSuggestionSheet), findsNothing);
      },
    );

    testWidgets(
      'a failed save keeps the sheet open with the error, and Save is available again',
      (WidgetTester tester) async {
        final opened = await _open(tester);
        opened.repository.createError = const HouseholdFullError(
          'Your recipe library is full.',
        );

        await tester.tap(
          find.byKey(SaveSuggestionSheet.roleChipKey(RecipeRole.sabziDal)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(SaveSuggestionSheet.saveButtonKey));
        await tester.pumpAndSettle();

        expect(find.text('Your recipe library is full.'), findsOneWidget);
        expect(find.byKey(SaveSuggestionSheet.saveButtonKey), findsOneWidget);
        expect(
          tester
              .widget<PButton>(find.byKey(SaveSuggestionSheet.saveButtonKey))
              .onPressed,
          isNotNull,
        );
      },
    );

    testWidgets(
      'a suggestion the model never proposed a role for cannot be saved until one is picked',
      (WidgetTester tester) async {
        final CookSuggestion noRole = CookSuggestion(
          id: 'sugg-2',
          draft: const AiRecipeDraft(title: 'Mystery Dish'),
          ingredientMatches: const <CookIngredientMatch>[],
          have: const <String>[],
          missing: const <String>[],
        );
        await _open(tester, suggestion: noRole);

        expect(
          tester
              .widget<PButton>(find.byKey(SaveSuggestionSheet.saveButtonKey))
              .onPressed,
          isNull,
        );
        await tester.tap(
          find.byKey(SaveSuggestionSheet.roleChipKey(RecipeRole.snack)),
        );
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<PButton>(find.byKey(SaveSuggestionSheet.saveButtonKey))
              .onPressed,
          isNotNull,
        );
      },
    );
  });
}
