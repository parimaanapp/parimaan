import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/current_week.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/menu/presentation/ingredient_warning_dialog.dart';
import 'package:mobile/features/menu/presentation/recipe_picker_screen.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_ingredient.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_menu_repository.dart';
import '../../../support/fake_recipe_repository.dart';
import '../../../support/menu_fixtures.dart';

const RecipePickerExtra _extra = (
  dayOfWeek: 2,
  mealSlot: 'lunch',
  slotRole: RecipeRole.sabziDal,
);

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeRecipeRepository recipeRepository,
  FakeMenuRepository? menuRepository,
  Household? household,
  RecipePickerExtra extra = _extra,
}) async {
  final Household resolvedHousehold = household ?? testMenuHousehold;
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(
          myHouseholdsResult: <Household>[resolvedHousehold],
          fetchResult: resolvedHousehold,
        ),
      ),
      recipeRepositoryProvider.overrideWithValue(recipeRepository),
      menuRepositoryProvider.overrideWithValue(
        menuRepository ??
            FakeMenuRepository(
              fetchResult: Menu(
                id: 'menu-1',
                householdId: resolvedHousehold.id,
                weekStartDate: currentWeekStartDate(),
                items: const <MenuItem>[],
              ),
              addResult: testMenuItem,
            ),
      ),
    ],
  );
  addTearDown(container.dispose);
  await container.read(meHouseholdsControllerProvider.future);

  // Starts at `weeklyPlan`, THEN pushes into the picker — a picker with
  // nothing under it on the stack has nowhere for `context.pop()` (a
  // successful pick, or "Back") to land, which a bare `initialLocation:
  // recipePicker` would silently hide until a real pop was attempted.
  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.weeklyPlan,
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.weeklyPlan,
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('Weekly plan stub')),
      ),
      GoRoute(
        path: AppRoutes.recipePicker,
        builder: (BuildContext context, GoRouterState state) =>
            RecipePickerScreen(extra: state.extra! as RecipePickerExtra),
      ),
      GoRoute(
        path: '/home/recipes/new/method',
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('Recipe method stub')),
      ),
    ],
  );
  addTearDown(router.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
    ),
  );
  router.push(AppRoutes.recipePicker, extra: extra);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  return container;
}

Recipe _recipe(String id, String title, {bool isFavorite = false, bool inRotation = true}) => Recipe(
  id: id,
  householdId: 'household-1',
  sourceType: RecipeSource.user,
  title: title,
  servings: 4,
  dietaryTags: const <String>[],
  role: RecipeRole.sabziDal,
  inRotation: inRotation,
  isFavorite: isFavorite,
  steps: const <String>[],
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
);

void main() {
  group('RecipePickerScreen', () {
    testWidgets('shows a loading indicator before recipes resolve', (
      WidgetTester tester,
    ) async {
      // A real delay LONGER than `_pump`'s own transition-settling pump
      // (300ms) — otherwise the same pump that settles the page-transition
      // animation also gives the fetch enough time to resolve, and there
      // is no way to observe "mid-transition, fetch still pending" with a
      // zero-delay fake (go_router test timing: the route's own content
      // genuinely does not render until the transition settles).
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_recipe('recipe-1', 'Dal')],
        delay: const Duration(milliseconds: 500),
      );
      await _pump(tester, recipeRepository: repository);

      expect(find.byKey(RecipePickerScreen.loadingKey), findsOneWidget);

      // Flushes the still-pending delayed Future so no Timer is left
      // dangling at test teardown (flutter_test's own `!timersPending`
      // invariant check).
      await tester.pump(const Duration(milliseconds: 500));
    });

    testWidgets('a load failure renders the error state, distinct from empty', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        error: const ForbiddenError('Not a member.'),
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipePickerScreen.errorKey), findsOneWidget);
      expect(find.byKey(RecipePickerScreen.emptyStateKey), findsNothing);
      expect(find.text('Not a member.'), findsOneWidget);
    });

    testWidgets('an empty role-filtered library renders a real empty state with a working route to recipe creation', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: const <Recipe>[],
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(RecipePickerScreen.emptyStateKey), findsOneWidget);
      expect(find.byKey(RecipePickerScreen.errorKey), findsNothing);

      await tester.tap(find.text('Add a recipe'));
      await tester.pumpAndSettle();

      expect(find.text('Recipe method stub'), findsOneWidget);
    });

    testWidgets('fetches recipes filtered to the tapped slot\'s own role', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository repository = FakeRecipeRepository(
        result: <Recipe>[_recipe('recipe-1', 'Dal')],
      );
      await _pump(tester, recipeRepository: repository);
      await tester.pumpAndSettle();

      expect(repository.calls.single.role, RecipeRole.sabziDal);
      expect(find.text('Dal'), findsOneWidget);
    });

    testWidgets('picking a recipe calls addMenuItem with the exact originating slot coordinates', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository recipeRepository = FakeRecipeRepository(
        result: <Recipe>[_recipe('recipe-1', 'Dal')],
        detailResult: _recipe('recipe-1', 'Dal'),
      );
      final FakeMenuRepository menuRepository = FakeMenuRepository(
        fetchResult: Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
        ),
        addResult: testMenuItem,
      );
      await _pump(
        tester,
        recipeRepository: recipeRepository,
        menuRepository: menuRepository,
        extra: const (dayOfWeek: 4, mealSlot: 'dinner', slotRole: RecipeRole.accompaniment),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Dal'));
      await tester.pumpAndSettle();

      expect(menuRepository.addCalls, hasLength(1));
      final NewMenuItem draft = menuRepository.addCalls.single.$2;
      expect(draft.recipeId, 'recipe-1');
      expect(draft.dayOfWeek, 4);
      expect(draft.mealSlot, 'dinner');
      expect(draft.slotRole, RecipeRole.accompaniment);
      // Success pops back to the Weekly plan.
      expect(find.text('Weekly plan stub'), findsOneWidget);
    });

    testWidgets('a cap-rejection surfaces inline, not silently — the picker stays open', (
      WidgetTester tester,
    ) async {
      final FakeRecipeRepository recipeRepository = FakeRecipeRepository(
        result: <Recipe>[_recipe('recipe-1', 'Dal')],
        detailResult: _recipe('recipe-1', 'Dal'),
      );
      final FakeMenuRepository menuRepository = FakeMenuRepository(
        fetchResult: Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
        ),
        addError: const ConflictError('This meal slot is full.'),
      );
      await _pump(
        tester,
        recipeRepository: recipeRepository,
        menuRepository: menuRepository,
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Dal'));
      await tester.pumpAndSettle();

      expect(find.text('This meal slot is full.'), findsOneWidget);
      // Never a silent no-op or a navigation away — the picker is still here.
      expect(find.byType(RecipePickerScreen), findsOneWidget);
    });

    testWidgets('an allergen match warns and still allows proceeding', (
      WidgetTester tester,
    ) async {
      final Household householdWithAllergen = Household(
        id: 'household-1',
        name: testMenuHousehold.name,
        inviteCode: testMenuHousehold.inviteCode,
        primaryUserId: testMenuHousehold.primaryUserId,
        subscriptionStatus: testMenuHousehold.subscriptionStatus,
        settings: HouseholdSettings(
          householdId: 'household-1',
          mealsEnabled: testMenuHousehold.settings.mealsEnabled,
          mealStructureJson: testMenuHousehold.settings.mealStructureJson,
          cuisineTier1: testMenuHousehold.settings.cuisineTier1,
          cuisineTier2WeightsJson: testMenuHousehold.settings.cuisineTier2WeightsJson,
          dietaryTags: testMenuHousehold.settings.dietaryTags,
          allergens: const <String>['peanut'],
          skipIngredients: const <String>[],
        ),
        members: testMenuHousehold.members,
      );

      final Recipe recipeWithPeanuts = Recipe(
        id: 'recipe-1',
        householdId: 'household-1',
        sourceType: RecipeSource.user,
        title: 'Peanut Sabzi',
        servings: 4,
        dietaryTags: const <String>[],
        role: RecipeRole.sabziDal,
        inRotation: true,
        isFavorite: false,
        ingredients: const <RecipeIngredient>[
          RecipeIngredient(id: 'ing-1', name: 'Crushed Peanuts', isStaple: false),
        ],
        steps: const <String>[],
        createdAt: DateTime.utc(2026, 9, 1),
        updatedAt: DateTime.utc(2026, 9, 1),
      );

      final FakeRecipeRepository recipeRepository = FakeRecipeRepository(
        result: <Recipe>[recipeWithPeanuts],
        detailResult: recipeWithPeanuts,
      );
      final FakeMenuRepository menuRepository = FakeMenuRepository(
        fetchResult: Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
        ),
        addResult: testMenuItem,
      );
      await _pump(
        tester,
        recipeRepository: recipeRepository,
        menuRepository: menuRepository,
        household: householdWithAllergen,
      );
      await tester.pumpAndSettle();

      // The recipe still appears in the list — never hidden.
      expect(find.text('Peanut Sabzi'), findsOneWidget);

      await tester.tap(find.text('Peanut Sabzi'));
      await tester.pumpAndSettle();

      expect(find.byType(IngredientWarningDialog), findsOneWidget);
      expect(find.textContaining('peanut'), findsWidgets);

      await tester.tap(find.byKey(IngredientWarningDialog.proceedButtonKey));
      await tester.pumpAndSettle();

      expect(menuRepository.addCalls, hasLength(1));
      expect(menuRepository.addCalls.single.$2.recipeId, 'recipe-1');
    });

    testWidgets('cancelling the ingredient warning does NOT add the item', (
      WidgetTester tester,
    ) async {
      final Household householdWithAllergen = Household(
        id: 'household-1',
        name: testMenuHousehold.name,
        inviteCode: testMenuHousehold.inviteCode,
        primaryUserId: testMenuHousehold.primaryUserId,
        subscriptionStatus: testMenuHousehold.subscriptionStatus,
        settings: HouseholdSettings(
          householdId: 'household-1',
          mealsEnabled: testMenuHousehold.settings.mealsEnabled,
          mealStructureJson: testMenuHousehold.settings.mealStructureJson,
          cuisineTier1: testMenuHousehold.settings.cuisineTier1,
          cuisineTier2WeightsJson: testMenuHousehold.settings.cuisineTier2WeightsJson,
          dietaryTags: testMenuHousehold.settings.dietaryTags,
          allergens: const <String>['peanut'],
          skipIngredients: const <String>[],
        ),
        members: testMenuHousehold.members,
      );

      final Recipe recipeWithPeanuts = Recipe(
        id: 'recipe-1',
        householdId: 'household-1',
        sourceType: RecipeSource.user,
        title: 'Peanut Sabzi',
        servings: 4,
        dietaryTags: const <String>[],
        role: RecipeRole.sabziDal,
        inRotation: true,
        isFavorite: false,
        ingredients: const <RecipeIngredient>[
          RecipeIngredient(id: 'ing-1', name: 'Crushed Peanuts', isStaple: false),
        ],
        steps: const <String>[],
        createdAt: DateTime.utc(2026, 9, 1),
        updatedAt: DateTime.utc(2026, 9, 1),
      );

      final FakeRecipeRepository recipeRepository = FakeRecipeRepository(
        result: <Recipe>[recipeWithPeanuts],
        detailResult: recipeWithPeanuts,
      );
      final FakeMenuRepository menuRepository = FakeMenuRepository(
        fetchResult: Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
        ),
        addResult: testMenuItem,
      );
      await _pump(
        tester,
        recipeRepository: recipeRepository,
        menuRepository: menuRepository,
        household: householdWithAllergen,
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Peanut Sabzi'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(IngredientWarningDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(menuRepository.addCalls, isEmpty);
      // Still on the picker — no navigation away.
      expect(find.byType(RecipePickerScreen), findsOneWidget);
    });
  });
}
