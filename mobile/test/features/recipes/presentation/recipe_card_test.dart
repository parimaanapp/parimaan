import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/presentation/recipe_card.dart';

import '../../../support/component_harness.dart';

Recipe _recipe({
  String title = 'Toor Dal',
  RecipeRole role = RecipeRole.sabziDal,
  int? prepMin,
  int? cookMin,
  bool inRotation = false,
  bool isFavorite = false,
}) => Recipe(
  id: 'recipe-1',
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: title,
  servings: 4,
  prepMin: prepMin,
  cookMin: cookMin,
  dietaryTags: const <String>[],
  role: role,
  inRotation: inRotation,
  isFavorite: isFavorite,
  steps: const <String>['Boil the dal.'],
  createdAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

void main() {
  group('RecipeCard', () {
    testWidgets('renders the title and role', (WidgetTester tester) async {
      await pumpComponent(tester, RecipeCard(recipe: _recipe()));

      expect(find.text('Toor Dal'), findsOneWidget);
      expect(find.textContaining('Sabzi/Dal'), findsOneWidget);
    });

    testWidgets('shows the total time when prepMin and/or cookMin are set', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        RecipeCard(recipe: _recipe(prepMin: 10, cookMin: 20)),
      );

      expect(find.byKey(RecipeCard.totalTimeKey), findsOneWidget);
      expect(find.textContaining('30 min'), findsOneWidget);
    });

    testWidgets('shows no total-time text when both prepMin and cookMin are null', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, RecipeCard(recipe: _recipe()));

      expect(find.byKey(RecipeCard.totalTimeKey), findsNothing);
    });

    testWidgets('shows a favorite badge when isFavorite is true', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        RecipeCard(recipe: _recipe(isFavorite: true)),
      );
      expect(find.byKey(RecipeCard.favoriteBadgeKey), findsOneWidget);
    });

    testWidgets('shows no favorite badge when isFavorite is false', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, RecipeCard(recipe: _recipe()));
      expect(find.byKey(RecipeCard.favoriteBadgeKey), findsNothing);
    });

    testWidgets('shows an in-rotation badge when inRotation is true', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        RecipeCard(recipe: _recipe(inRotation: true)),
      );
      expect(find.byKey(RecipeCard.inRotationBadgeKey), findsOneWidget);
    });

    testWidgets('shows no in-rotation badge when inRotation is false', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, RecipeCard(recipe: _recipe()));
      expect(find.byKey(RecipeCard.inRotationBadgeKey), findsNothing);
    });

    testWidgets('tapping the card calls onTap', (WidgetTester tester) async {
      bool tapped = false;
      await pumpComponent(
        tester,
        RecipeCard(recipe: _recipe(), onTap: () => tapped = true),
      );
      await tester.tap(find.byType(RecipeCard));
      expect(tapped, isTrue);
    });
  });
}
