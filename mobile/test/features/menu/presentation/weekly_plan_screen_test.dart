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
import 'package:mobile/features/menu/presentation/auto_fill_preview_screen.dart';
import 'package:mobile/features/menu/presentation/meal_slot_card.dart';
import 'package:mobile/features/menu/presentation/recipe_picker_screen.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_screen.dart';
import 'package:mobile/features/menu/state/current_menu_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_menu_repository.dart';
import '../../../support/fake_recipe_repository.dart';
import '../../../support/menu_fixtures.dart';

// `testMenuHousehold`'s own `settings.mealsEnabled` is `[breakfast, lunch,
// dinner]` with a real, complete `mealStructureJson` (menu_fixtures.dart's
// own doc on why this fixture exists rather than reusing
// `household_fixtures.dart`'s `testHousehold`) — lunch's default
// mealStructure gives 4 slots, dinner 4, breakfast 1: 9 total, a household
// menu of no items against it renders 9 empty `MealSlotCard`s for Monday
// alone.

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeMenuRepository menuRepository,
  Household? household,
  FakeRecipeRepository? recipeRepository,
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
      menuRepositoryProvider.overrideWithValue(menuRepository),
      recipeRepositoryProvider.overrideWithValue(
        recipeRepository ?? FakeRecipeRepository(result: const <Recipe>[]),
      ),
    ],
  );
  addTearDown(container.dispose);
  // Same "await the household source before pumping" step
  // `pantry_list_screen_test.dart` uses — otherwise the screen's first
  // build races `Query.me`.
  await container.read(meHouseholdsControllerProvider.future);

  // A real (minimal) `GoRouter`, not a bare `MaterialApp(home:)` — the
  // screen navigates to `AppRoutes.recipePicker` via `context.push` (W9
  // S5's own fix for the Navigator/go_router inconsistency this test
  // exists to guard against), which throws without a real router ancestor.
  // Only the two routes this test actually exercises, not the full app
  // router — `household_route_harness.dart`'s own auth/deep-link machinery
  // is unrelated overhead for a screen that resolves its household via
  // `activeHouseholdProvider`, not a route parameter.
  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.weeklyPlan,
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.weeklyPlan,
        builder: (BuildContext context, GoRouterState state) =>
            const WeeklyPlanScreen(),
      ),
      GoRoute(
        path: AppRoutes.recipePicker,
        builder: (BuildContext context, GoRouterState state) =>
            RecipePickerScreen(extra: state.extra as RecipePickerExtra),
      ),
      GoRoute(
        path: AppRoutes.autoFillPreview,
        builder: (BuildContext context, GoRouterState state) =>
            AutoFillPreviewScreen(menuKey: state.extra as MenuKey),
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
  return container;
}

void main() {
  group('WeeklyPlanScreen', () {
    testWidgets('shows a loading indicator before the menu resolves', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);
      // No extra pump: the very first frame, before the fake repository's
      // own async gap resolves, is the loading state under test.

      expect(find.byKey(WeeklyPlanScreen.loadingKey), findsOneWidget);
    });

    testWidgets('a load failure renders the error state, not a blank screen', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchError: const ForbiddenError('Not a member.'),
        createError: const ForbiddenError('Not a member.'),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(WeeklyPlanScreen.errorKey), findsOneWidget);
      // A real PEmptyState with the AppError's own message and a retry
      // affordance — not a raw-text dead end.
      expect(find.text('Not a member.'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('retrying after a load failure re-fetches and can succeed', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        fetchError: const ForbiddenError('Not a member.'),
        fetchErrorFromCall: 1,
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();
      expect(find.byKey(WeeklyPlanScreen.errorKey), findsOneWidget);

      repository.fetchError = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.byKey(WeeklyPlanScreen.errorKey), findsNothing);
      expect(find.byType(MealSlotCard), findsWidgets);
    });

    testWidgets(
      'an empty menu renders every configured slot as empty ("+"), across all 7 days',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        // testMenuHousehold's settings enable breakfast/lunch/dinner: 1 + 4
        // + 4 = 9 slots per day, and this is Monday's own section (first in
        // the ListView, always built without scrolling).
        expect(find.byType(MealSlotCard), findsWidgets);
        expect(find.byIcon(Icons.add), findsWidgets);
        expect(find.text('Carb'), findsWidgets);
      },
    );

    testWidgets(
      'a filled slot renders the recipe title and does NOT show the "+" affordance',
      (WidgetTester tester) async {
        // testMenuItem is dayOfWeek: 0 (Monday), mealSlot: lunch, slotRole:
        // sabziDal — the screen always fetches the CURRENT week, so the fixture
        // menu's own weekStartDate must match that, not a fixed date.
        final Menu menuWithMondayItem = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[testMenuItem],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuWithMondayItem,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        final Finder filledCard = find.byKey(
          MealSlotCard.filledKey(testMenuItem.id),
        );
        expect(filledCard, findsOneWidget);
        expect(find.text(testMenuItem.recipe.title), findsWidgets);
        expect(
          find.descendant(of: filledCard, matching: find.byIcon(Icons.add)),
          findsNothing,
        );

        // A filled slot has no view/replace/remove destination yet — it
        // must NOT route into the "add" picker the way an empty slot does
        // (no double-add into an already-filled slot).
        await tester.tap(filledCard);
        await tester.pumpAndSettle();
        expect(find.byType(RecipePickerScreen), findsNothing);
      },
    );

    testWidgets('tapping an empty slot navigates to the recipe picker, carrying that slot\'s own coordinates', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byType(MealSlotCard).first);
      await tester.pumpAndSettle();

      expect(find.byType(RecipePickerScreen), findsOneWidget);
      // Monday's first slot in plannedSlotsForDay's own emission order is
      // breakfast (MealType.values' own order) — the transposition class
      // §15.6 exists to catch, asserted directly rather than assumed.
      final RecipePickerScreen picker = tester.widget(
        find.byType(RecipePickerScreen),
      );
      expect(picker.extra.dayOfWeek, 0);
      expect(picker.extra.mealSlot, 'breakfast');
    });

    testWidgets('tapping the Auto-fill week action navigates to the auto-fill preview screen', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(WeeklyPlanScreen.autoFillButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(AutoFillPreviewScreen), findsOneWidget);
      // The screen this pushed to is keyed by the CURRENT week — the very
      // first thing it does is call `previewAutoFill()` against the SAME
      // `CurrentMenuController` family member this screen reads, not a
      // freshly re-resolved one.
      expect(repository.previewCalls, hasLength(1));
    });
  });
}
