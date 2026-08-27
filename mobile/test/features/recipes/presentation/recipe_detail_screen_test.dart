import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/presentation/recipe_detail_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_recipe_repository.dart';
import '../../../support/household_fixtures.dart';

Recipe _recipe({
  List<RecipeIngredient>? ingredients,
  List<String> steps = const <String>['Heat oil.', 'Add dal.', 'Simmer.'],
}) => Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: 'Toor Dal',
  description: 'A simple daily dal.',
  servings: 4,
  prepMin: 10,
  cookMin: 20,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: true,
  isFavorite: true,
  ingredients:
      ingredients ??
      const <RecipeIngredient>[
        RecipeIngredient(id: 'ing-1', name: 'Toor dal', isStaple: true),
        RecipeIngredient(id: 'ing-2', name: 'Onion', isStaple: false),
      ],
  steps: steps,
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeRecipeRepository recipeRepository,
  String recipeId = 'recipe-1',
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(myHouseholdsResult: <Household>[testHousehold]),
      ),
      recipeRepositoryProvider.overrideWithValue(recipeRepository),
    ],
  );
  addTearDown(container.dispose);
  await container.read(meHouseholdsControllerProvider.future);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: RecipeDetailScreen(recipeId: recipeId),
      ),
    ),
  );
  return container;
}

void main() {
  group('RecipeDetailScreen', () {
    testWidgets('shows a loading indicator before the fetch resolves', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _recipe(),
        delay: const Duration(milliseconds: 50),
      );
      await _pump(tester, recipeRepository: repository);

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.pumpAndSettle();
    });

    testWidgets('renders ingredients and steps in order', (WidgetTester tester) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _recipe(),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.text('Toor Dal'), findsOneWidget);
      expect(find.textContaining('Toor dal'), findsOneWidget);
      expect(find.textContaining('Onion'), findsOneWidget);
      expect(find.text('1. Heat oil.'), findsOneWidget);
      expect(find.text('2. Add dal.'), findsOneWidget);
      expect(find.text('3. Simmer.'), findsOneWidget);
    });

    testWidgets('renders a zero-ingredient recipe without crashing', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _recipe(ingredients: const <RecipeIngredient>[]),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipeDetailScreen.ingredientsEmptyKey), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows the favorite and in-rotation badges', (WidgetTester tester) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _recipe(),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipeDetailScreen.favoriteBadgeKey), findsOneWidget);
      expect(find.byKey(RecipeDetailScreen.inRotationBadgeKey), findsOneWidget);
    });

    testWidgets('shows an error state with the server\'s copy, not a crash', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailError: const ForbiddenError('You are not a member of this household.'),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipeDetailScreen.errorStateKey), findsOneWidget);
      expect(
        find.textContaining('You are not a member of this household.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a NotFoundError also renders as copy, not a crash', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailError: const NotFoundError('Recipe not found.'),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipeDetailScreen.errorStateKey), findsOneWidget);
      expect(find.textContaining('Recipe not found.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('tapping the overflow button opens the Overflow menu', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        detailResult: _recipe(),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(RecipeDetailScreen.overflowButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('Remove favorite'), findsOneWidget);
      expect(find.text('Remove from rotation'), findsOneWidget);
      expect(find.text('Edit'), findsOneWidget);
      expect(find.text('Delete'), findsOneWidget);
    });
  });
}
