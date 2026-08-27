import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/presentation/recipes_library_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_recipe_repository.dart';
import '../../../support/household_fixtures.dart';

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

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeRecipeRepository recipeRepository,
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
  // Same "await the household source before pumping" step
  // `pantry_list_screen_test.dart` uses — otherwise the screen's first build
  // races `Query.me`.
  await container.read(meHouseholdsControllerProvider.future);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: const RecipesLibraryScreen(),
      ),
    ),
  );
  return container;
}

void main() {
  group('RecipesLibraryScreen', () {
    testWidgets('shows a loading indicator before the fetch resolves', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
        delay: const Duration(milliseconds: 50),
      );
      await _pump(tester, recipeRepository: repository);

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.pumpAndSettle();
    });

    testWidgets('renders one RecipeCard per recipe once loaded', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.text('Toor Dal'), findsOneWidget);
    });

    testWidgets('shows an empty state when the library has no recipes', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[],
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipesLibraryScreen.emptyStateKey), findsOneWidget);
    });

    testWidgets('shows an error state when the repository throws', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        error: const InternalError('network down'),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipesLibraryScreen.errorStateKey), findsOneWidget);
    });

    testWidgets('renders a role chip row', (WidgetTester tester) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[],
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.widgetWithText(PChip, 'Sabzi/Dal'), findsOneWidget);
    });

    testWidgets(
      'tapping a role chip refetches server-side with that role, not a client-side filter',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          result: <Recipe>[_dalRecipe],
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.widgetWithText(PChip, 'Sabzi/Dal'));
        await tester.pumpAndSettle();

        expect(repository.calls.last.role, RecipeRole.sabziDal);
        // Two calls total: the initial unfiltered `build()` fetch, then the
        // chip-tap refetch — never more, which is what "server-side, not
        // client-side" means here: a client-side filter would not have
        // issued a second network call at all.
        expect(repository.calls.length, 2);
      },
    );

    testWidgets('tapping the favorites chip refetches with isFavorite: true', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_dalRecipe],
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(RecipesLibraryScreen.favoritesChipKey));
      await tester.pumpAndSettle();

      expect(repository.calls.last.isFavorite, isTrue);
    });

    testWidgets(
      'a failed filtered refetch shows a stale-data banner, not a silent '
      'success',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          result: <Recipe>[_dalRecipe],
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();

        repository.error = const InternalError('network down');
        await tester.tap(find.byKey(RecipesLibraryScreen.favoritesChipKey));
        await tester.pumpAndSettle();

        // The last-good list (`copyWithPrevious`) is still on screen...
        expect(find.text('Toor Dal'), findsOneWidget);
        // ...but the banner makes clear the refetch itself failed, rather
        // than looking like a successful, unfiltered result.
        expect(
          find.byKey(RecipesLibraryScreen.staleBannerKey),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'retrying after a failed initial load re-applies the already-selected '
      'filters instead of dropping them',
      (WidgetTester tester) async {
        // The initial load itself fails — no previous data at all, so this
        // lands in the (null, error) "Try again" branch, not the stale-data
        // banner branch tested above.
        final FakeRecipeRepository repository = FakeRecipeRepository(
          error: const InternalError('network down'),
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();
        expect(find.byKey(RecipesLibraryScreen.errorStateKey), findsOneWidget);

        // Selecting a role while already in the error state still updates
        // this widget's own filter selection (the chip row renders
        // independently of the switch below it) — the refetch it triggers
        // fails too, since the repository is still stubbed to error.
        await tester.tap(find.widgetWithText(PChip, 'Sabzi/Dal'));
        await tester.pumpAndSettle();
        expect(repository.calls.last.role, RecipeRole.sabziDal);

        repository.error = null;
        repository.result = <Recipe>[_dalRecipe];
        await tester.tap(find.text('Try again'));
        await tester.pumpAndSettle();

        // The retry must still be scoped to the role filter the chips show
        // as selected — a `ref.invalidate` retry would have silently reset
        // to unfiltered.
        expect(repository.calls.last.role, RecipeRole.sabziDal);
      },
    );
  });
}
