import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/presentation/recipe_overflow_menu.dart';
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

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeRecipeRepository repository,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  await container.read(recipeDetailControllerProvider(_arg).future);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: ElevatedButton(
                onPressed: () => showRecipeOverflowMenu(context: context, arg: _arg),
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
  return container;
}

void main() {
  group('RecipeOverflowMenu', () {
    testWidgets('shows "Favorite" for a non-favorite recipe', (WidgetTester tester) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      await _pump(tester, repository: repository);

      expect(find.text('Favorite'), findsOneWidget);
      expect(find.text('Remove favorite'), findsNothing);
    });

    testWidgets('tapping favorite calls favoriteRecipe with true', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        favoriteResult: _dalRecipe,
        result: <Recipe>[_dalRecipe],
      );
      await _pump(tester, repository: repository);

      await tester.tap(find.byKey(RecipeOverflowMenu.favoriteRowKey));
      await tester.pumpAndSettle();

      expect(repository.favoriteCalls, <({String id, bool favorite})>[
        (id: 'recipe-1', favorite: true),
      ]);
    });

    testWidgets('tapping rotation calls setInRotation with true', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        setInRotationResult: _dalRecipe,
        result: <Recipe>[_dalRecipe],
      );
      await _pump(tester, repository: repository);

      await tester.tap(find.byKey(RecipeOverflowMenu.rotationRowKey));
      await tester.pumpAndSettle();

      expect(repository.setInRotationCalls, <({String id, bool inRotation})>[
        (id: 'recipe-1', inRotation: true),
      ]);
    });

    testWidgets('the Edit row is disabled (S8 has not shipped yet)', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
      );
      await _pump(tester, repository: repository);

      final Finder editRow = find.byKey(RecipeOverflowMenu.editRowKey);
      expect(editRow, findsOneWidget);
      // A disabled PCard renders with onTap: null — tapping is a no-op, no
      // action is dispatched.
      await tester.tap(editRow);
      await tester.pump();
      expect(repository.favoriteCalls, isEmpty);
      expect(repository.setInRotationCalls, isEmpty);
      expect(repository.deleteCalls, isEmpty);
    });

    testWidgets('shows the server error message on a failed toggle', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _dalRecipe,
        favoriteError: const ForbiddenError('You are not a member of this household.'),
      );
      await _pump(tester, repository: repository);

      await tester.tap(find.byKey(RecipeOverflowMenu.favoriteRowKey));
      await tester.pumpAndSettle();

      expect(find.byKey(RecipeOverflowMenu.errorKey), findsOneWidget);
      expect(
        find.textContaining('You are not a member of this household.'),
        findsOneWidget,
      );
    });
  });
}
