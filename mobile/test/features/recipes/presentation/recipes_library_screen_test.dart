import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/features/recipes/presentation/recipe_method_screen.dart';
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

/// Real (minimal) `GoRouter`, not a plain `MaterialApp` — W7 S8 moved both
/// FAB call sites from `context.push(AppRoutes.recipeCreate(...))` straight
/// to `AppRoutes.recipeChooseMethod(...)`, and `context.push` needs a real
/// `GoRouter` ancestor (`recipe_overflow_menu_test.dart`'s own precedent for
/// this exact fix). The chooser route renders the real `RecipeMethodScreen`
/// — a plain `StatelessWidget` with no provider dependencies of its own, so
/// there is nothing to fake here.
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

  final GoRouter router = GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext context, GoRouterState state) =>
            const RecipesLibraryScreen(),
      ),
      GoRoute(
        path: '/home/recipes/new/method',
        builder: (BuildContext context, GoRouterState state) =>
            RecipeMethodScreen(
              householdId: state.uri.queryParameters['householdId'] ?? '',
            ),
      ),
    ],
  );

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
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

    testWidgets(
      'tapping the top-bar "Add a recipe" button opens the method chooser, not the structured form directly',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          result: <Recipe>[_dalRecipe],
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.bySemanticsLabel('Add a recipe'));
        await tester.pumpAndSettle();

        expect(find.byType(RecipeMethodScreen), findsOneWidget);
      },
    );

    testWidgets(
      'tapping the empty-state "Add a recipe" button opens the method chooser, not the structured form directly',
      (WidgetTester tester) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          result: <Recipe>[],
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.text('Add a recipe'));
        await tester.pumpAndSettle();

        expect(find.byType(RecipeMethodScreen), findsOneWidget);
      },
    );

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

    group('empty states', () {
      testWidgets(
        'genuinely empty library, no filter: original copy, no Clear filter',
        (WidgetTester tester) async {
          final FakeRecipeRepository repository = FakeRecipeRepository(
            result: <Recipe>[],
          );
          await _pump(tester, recipeRepository: repository);
          await tester.pumpAndSettle();

          expect(find.byKey(RecipesLibraryScreen.emptyStateKey), findsOneWidget);
          expect(find.text('No recipes yet'), findsOneWidget);
          expect(
            find.byKey(RecipesLibraryScreen.filteredEmptyStateKey),
            findsNothing,
          );
          expect(find.text('Clear filter'), findsNothing);
        },
      );

      testWidgets(
        'regression: a role filter with zero matches names the role and '
        'offers Clear filter, not "No recipes yet"',
        (WidgetTester tester) async {
          final FakeRecipeRepository repository = FakeRecipeRepository(
            result: <Recipe>[_dalRecipe],
          );
          await _pump(tester, recipeRepository: repository);
          await tester.pumpAndSettle();
          expect(find.text('Toor Dal'), findsOneWidget);

          // The library is non-empty elsewhere; the filtered fetch is empty.
          repository.result = <Recipe>[];
          await tester.tap(find.widgetWithText(PChip, 'Carb'));
          await tester.pumpAndSettle();

          expect(
            find.byKey(RecipesLibraryScreen.filteredEmptyStateKey),
            findsOneWidget,
          );
          expect(find.text('No Carb recipes yet'), findsOneWidget);
          expect(find.text('No recipes yet'), findsNothing);
          expect(find.text('Clear filter'), findsOneWidget);
          expect(
            find.byKey(RecipesLibraryScreen.filteredAddButtonKey),
            findsOneWidget,
          );
        },
      );

      testWidgets('Clear filter deselects the chip and refetches unfiltered', (
        WidgetTester tester,
      ) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          result: <Recipe>[],
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(PChip, 'Carb'));
        await tester.pumpAndSettle();
        expect(repository.calls.last.role, RecipeRole.carb);

        repository.result = <Recipe>[_dalRecipe];
        await tester.tap(find.text('Clear filter'));
        await tester.pumpAndSettle();

        expect(repository.calls.last.role, isNull);
        expect(repository.calls.last.isFavorite, isNull);
        expect(find.text('Toor Dal'), findsOneWidget);
        expect(
          tester.widget<PChip>(find.widgetWithText(PChip, 'Carb')).selected,
          isFalse,
        );
      });

      testWidgets('the secondary Add a recipe opens the method chooser', (
        WidgetTester tester,
      ) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          result: <Recipe>[],
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(PChip, 'Carb'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(RecipesLibraryScreen.filteredAddButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(RecipeMethodScreen), findsOneWidget);
      });

      testWidgets('a favorites filter with zero matches also gets filter copy', (
        WidgetTester tester,
      ) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          result: <Recipe>[_dalRecipe],
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();

        repository.result = <Recipe>[];
        await tester.tap(find.byKey(RecipesLibraryScreen.favoritesChipKey));
        await tester.pumpAndSettle();

        expect(find.text('No favorite recipes yet'), findsOneWidget);
        expect(find.text('Clear filter'), findsOneWidget);
      });

      testWidgets(
        'while a filter refetch is in flight over an empty result, shows '
        'progress and never an empty card',
        (WidgetTester tester) async {
          final FakeRecipeRepository repository = FakeRecipeRepository(
            result: <Recipe>[],
          );
          await _pump(tester, recipeRepository: repository);
          await tester.pumpAndSettle();
          expect(find.byKey(RecipesLibraryScreen.emptyStateKey), findsOneWidget);

          repository.delay = const Duration(milliseconds: 50);
          await tester.tap(find.widgetWithText(PChip, 'Carb'));
          await tester.pump();

          expect(find.byType(CircularProgressIndicator), findsOneWidget);
          expect(find.byKey(RecipesLibraryScreen.emptyStateKey), findsNothing);
          expect(
            find.byKey(RecipesLibraryScreen.filteredEmptyStateKey),
            findsNothing,
          );
          await tester.pumpAndSettle();
        },
      );

      testWidgets('an error with a filter selected offers retry, not empty copy', (
        WidgetTester tester,
      ) async {
        final FakeRecipeRepository repository = FakeRecipeRepository(
          error: const InternalError('network down'),
        );
        await _pump(tester, recipeRepository: repository);
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(PChip, 'Carb'));
        await tester.pumpAndSettle();

        expect(find.byKey(RecipesLibraryScreen.errorStateKey), findsOneWidget);
        expect(find.text('Try again'), findsOneWidget);
        expect(find.text('No Carb recipes yet'), findsNothing);
        expect(find.text('No recipes yet'), findsNothing);
      });
    });
  });

  group('RecipesLibraryScreen — pagination (B2c)', () {
    List<Recipe> many(int count) => <Recipe>[
      for (int i = 0; i < count; i++)
        Recipe(
          id: 'recipe-$i',
          householdId: 'household-1',
          sourceType: RecipeSource.user,
          title: 'Recipe $i',
          servings: 4,
          dietaryTags: const <String>[],
          role: RecipeRole.sabziDal,
          inRotation: false,
          isFavorite: false,
          steps: const <String>[],
          createdAt: DateTime.utc(2026, 8, 25),
          updatedAt: DateTime.utc(2026, 8, 25),
        ),
    ];

    testWidgets('loads only the first page up front', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: many(230),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(repository.pageCalls, hasLength(1));
      expect(repository.pageCalls.single.limit, 50);
    });

    testWidgets('scrolling to the end requests the next page', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: many(230),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      for (int i = 0; i < 12; i++) {
        await tester.drag(find.byType(ListView).last, const Offset(0, -2000));
        await tester.pump();
      }
      await tester.pumpAndSettle();

      expect(
        repository.pageCalls.map((p) => p.offset),
        containsAllInOrder(<int?>[0, 50]),
      );
    });

    testWidgets('does not ask for more when the library fits one page', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: many(5),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      await tester.drag(find.byType(ListView).last, const Offset(0, -2000));
      await tester.pumpAndSettle();

      expect(repository.pageCalls, hasLength(1));
    });
  });
}
