import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/presentation/delete_recipe_dialog.dart';
import 'package:mobile/features/recipes/state/recipe_detail_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_recipe_repository.dart';

final Recipe _dalRecipe = Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: 'Toor Dal',
  servings: 4,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: false,
  isFavorite: false,
  steps: const <String>['Boil the dal.'],
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

const RecipeDetailArg _arg = (householdId: 'household-1', id: 'recipe-1');

Future<({ProviderContainer container, ValueNotifier<bool?> result})> _pump(
  WidgetTester tester, {
  required FakeRecipeRepository repository,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);

  final ValueNotifier<bool?> result = ValueNotifier<bool?>(null);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: ElevatedButton(
                onPressed: () async {
                  result.value = await showDeleteRecipeDialog(
                    context: context,
                    arg: _arg,
                    recipe: _dalRecipe,
                  );
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return (container: container, result: result);
}

void main() {
  group('DeleteRecipeDialog', () {
    testWidgets('cancel is a no-op — closes without calling deleteRecipe', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository();
      final result = await _pump(tester, repository: repository);

      await tester.tap(find.byKey(DeleteRecipeDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(repository.deleteCalls, isEmpty);
      expect(result.result.value, isFalse);
      expect(find.byType(DeleteRecipeDialog), findsNothing);
    });

    testWidgets('confirm calls deleteRecipe and closes with true on success', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        deleteResult: _dalRecipe,
      );
      final result = await _pump(tester, repository: repository);

      await tester.tap(find.byKey(DeleteRecipeDialog.confirmButtonKey));
      await tester.pumpAndSettle();

      expect(repository.deleteCalls, <String>['recipe-1']);
      expect(result.result.value, isTrue);
      expect(find.byType(DeleteRecipeDialog), findsNothing);
    });

    testWidgets('a failed delete keeps the dialog open and shows the server message', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        deleteError: const NotFoundError('Recipe not found.'),
      );
      await _pump(tester, repository: repository);

      await tester.tap(find.byKey(DeleteRecipeDialog.confirmButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(DeleteRecipeDialog), findsOneWidget);
      expect(find.textContaining('Recipe not found.'), findsOneWidget);
    });
  });
}
