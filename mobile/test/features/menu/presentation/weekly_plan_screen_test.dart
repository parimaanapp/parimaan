import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/current_week.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/menu/presentation/auto_fill_preview_screen.dart';
import 'package:mobile/features/menu/presentation/recipe_picker_screen.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_grid.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_screen.dart';
import 'package:mobile/features/menu/state/current_menu_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/colors.dart';
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

/// [testMenuHousehold] with all four meal types enabled (it only enables
/// breakfast/lunch/dinner) — W13 S5's own "all four meals" RED test needs a
/// household that actually plans Snacks, which is otherwise the one meal
/// type no fixture in this suite turns on.
final Household testMenuHouseholdAllMeals = Household(
  id: testMenuHousehold.id,
  name: testMenuHousehold.name,
  inviteCode: testMenuHousehold.inviteCode,
  primaryUserId: testMenuHousehold.primaryUserId,
  subscriptionStatus: testMenuHousehold.subscriptionStatus,
  settings: HouseholdSettings(
    householdId: testMenuHousehold.settings.householdId,
    mealsEnabled: const <String>['breakfast', 'lunch', 'snacks', 'dinner'],
    mealStructureJson: testMenuHousehold.settings.mealStructureJson,
    cuisineTier1: testMenuHousehold.settings.cuisineTier1,
    cuisineTier2WeightsJson: testMenuHousehold.settings.cuisineTier2WeightsJson,
    dietaryTags: testMenuHousehold.settings.dietaryTags,
    allergens: testMenuHousehold.settings.allergens,
    skipIngredients: testMenuHousehold.settings.skipIngredients,
  ),
  members: testMenuHousehold.members,
);

/// [testMenuHousehold] with Lunch's own `mealStructure` widened to
/// `{carb: 2, sabzi_dal: 3, accompaniment: 2}` — W13 S5's own "seven slot
/// cards under one Lunch header" RED test (E2E_MVP_PLAN.md §19.3 S5),
/// exercising a non-default per-role count rather than assuming the
/// default `{1, 2, 1}` shape generalizes.
final Household testMenuHouseholdWideLunch = Household(
  id: testMenuHousehold.id,
  name: testMenuHousehold.name,
  inviteCode: testMenuHousehold.inviteCode,
  primaryUserId: testMenuHousehold.primaryUserId,
  subscriptionStatus: testMenuHousehold.subscriptionStatus,
  settings: HouseholdSettings(
    householdId: testMenuHousehold.settings.householdId,
    mealsEnabled: testMenuHousehold.settings.mealsEnabled,
    mealStructureJson:
        '{"lunch":{"carb":2,"sabzi_dal":3,"accompaniment":2},'
        '"dinner":{"carb":1,"sabzi_dal":2,"accompaniment":1}}',
    cuisineTier1: testMenuHousehold.settings.cuisineTier1,
    cuisineTier2WeightsJson: testMenuHousehold.settings.cuisineTier2WeightsJson,
    dietaryTags: testMenuHousehold.settings.dietaryTags,
    allergens: testMenuHousehold.settings.allergens,
    skipIngredients: testMenuHousehold.settings.skipIngredients,
  ),
  members: testMenuHousehold.members,
);

/// Rewrites [menu]'s own [Menu.mealConfigSnapshot] to match [settings] —
/// used by [_pump] so a test that hands it a `household:` override (to
/// control which meals/structure render, W13 S5's own precedent) still
/// gets that SAME configuration honored now that the grid reads it from
/// the menu's snapshot rather than the household's live settings (W14 S4,
/// E2E_MVP_PLAN.md §20.2.4) — without every such test having to build its
/// own snapshot-carrying [Menu] by hand.
Menu _withSnapshotOf(Menu menu, HouseholdSettings settings) => Menu(
  id: menu.id,
  householdId: menu.householdId,
  weekStartDate: menu.weekStartDate,
  items: menu.items,
  mealConfigSnapshot: mealConfigSnapshotJsonFor(settings),
);

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeMenuRepository menuRepository,
  Household? household,
  FakeRecipeRepository? recipeRepository,
  // `false` only for W14 S4's own "menu snapshot wins over live settings"
  // RED tests, which deliberately construct a `menuRepository` whose menu
  // carries a snapshot that DISAGREES with `household`'s live settings —
  // the whole point of those tests is that this sync must NOT happen for
  // them. Every other caller wants the default: `household:` still steers
  // rendering the way it did before the snapshot existed (W13 S5's own
  // precedent), via this sync rather than by rebuilding every existing
  // test's own `Menu` fixture by hand.
  bool syncMenuSnapshotToHousehold = true,
  DateTime? today,
}) async {
  final Household resolvedHousehold = household ?? testMenuHousehold;
  if (syncMenuSnapshotToHousehold) {
    // The grid now reads meal config from the MENU's own snapshot, not the
    // household's live settings (W14 S4) — so a test that passes a
    // `household:` override to steer which meals/structure render needs
    // that override reflected in the menu this repository hands back too,
    // or the grid would silently keep using whatever snapshot the caller's
    // fixture `Menu` already carried.
    if (menuRepository.fetchResult != null) {
      menuRepository.fetchResult = _withSnapshotOf(
        menuRepository.fetchResult!,
        resolvedHousehold.settings,
      );
    }
    if (menuRepository.createResult != null) {
      menuRepository.createResult = _withSnapshotOf(
        menuRepository.createResult!,
        resolvedHousehold.settings,
      );
    }
  }
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
            WeeklyPlanScreen(today: today),
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

MenuItem _lunchItem(String id, RecipeRole role) => MenuItem(
  id: id,
  menuId: 'menu-1',
  recipe: testMenuRecipe,
  dayOfWeek: 0,
  mealSlot: 'lunch',
  slotRole: role,
);

Menu _menuWith(List<MenuItem> items, {Household? household}) => Menu(
  id: 'menu-1',
  householdId: 'household-1',
  weekStartDate: currentWeekStartDate(),
  items: items,
  mealConfigSnapshot: mealConfigSnapshotJsonFor(
    (household ?? testMenuHousehold).settings,
  ),
);

RecipePickerScreen _picker(WidgetTester tester) =>
    tester.widget(find.byType(RecipePickerScreen));

void main() {
  group('WeeklyPlanScreen', () {
    testWidgets('shows a loading indicator before the menu resolves', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);

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
      expect(find.byType(WeeklyPlanGrid), findsOneWidget);
    });

    testWidgets('an empty menu renders every planned meal as an empty cell', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(WeeklyPlanGrid.plusKey), findsWidgets);
      expect(
        find.byKey(WeeklyPlanGrid.cellKey(0, MealType.lunch)),
        findsOneWidget,
      );
    });

    testWidgets(
      'a filled slot renders the recipe title and is inert on tap, as before',
      (WidgetTester tester) async {
        final Menu menu = _menuWith(<MenuItem>[
          testMenuItem,
          _lunchItem('i2', RecipeRole.carb),
          _lunchItem('i3', RecipeRole.sabziDal),
          _lunchItem('i4', RecipeRole.accompaniment),
        ]);
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menu,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        final Finder cell = find.byKey(
          WeeklyPlanGrid.cellKey(0, MealType.lunch),
        );
        expect(
          find.descendant(of: cell, matching: find.textContaining('Rajma')),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: cell,
            matching: find.byKey(WeeklyPlanGrid.plusKey),
          ),
          findsNothing,
        );

        await tester.tap(cell);
        await tester.pumpAndSettle();
        expect(find.byType(RecipePickerScreen), findsNothing);
      },
    );

    testWidgets(
      "tapping an empty cell opens the picker for that cell's own slot",
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(WeeklyPlanGrid.cellKey(0, MealType.breakfast)),
        );
        await tester.pumpAndSettle();

        expect(find.byType(RecipePickerScreen), findsOneWidget);
        expect(_picker(tester).extra.dayOfWeek, 0);
        expect(_picker(tester).extra.mealSlot, 'breakfast');
      },
    );

    testWidgets(
      'the dark "Auto-fill empty slots" action opens the auto-fill preview',
      (WidgetTester tester) async {
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

        expect(find.text('◆ Auto-fill empty slots'), findsOneWidget);
        await tester.tap(find.byKey(WeeklyPlanScreen.autoFillButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(AutoFillPreviewScreen), findsOneWidget);
        expect(repository.previewCalls, hasLength(1));
      },
    );
  });

  group('WeeklyPlanScreen week header', () {
    // Thursday 15 Oct 2026: its week is Mon 12 - Sun 18 Oct.
    final DateTime thursday = DateTime.utc(2026, 10, 15);

    testWidgets('shows the date range and outlines today', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository, today: thursday);
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(WeeklyPlanScreen.weekRangeKey)).data,
        '12 – 18 Oct',
      );
      final Container today = tester.widget(
        find.byKey(WeeklyPlanGrid.dayCardKey(3)),
      );
      expect(
        ((today.decoration! as BoxDecoration).border! as Border).top.color,
        AppColors.terracotta,
      );
    });

    testWidgets('next/previous week fetch that week and drop the highlight', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository, today: thursday);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(WeeklyPlanScreen.nextWeekKey));
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(WeeklyPlanScreen.weekRangeKey)).data,
        '19 – 25 Oct',
      );
      expect(
        repository.fetchCalls.map((c) => c.$2),
        contains(DateTime.utc(2026, 10, 19)),
      );
      final Container card = tester.widget(
        find.byKey(WeeklyPlanGrid.dayCardKey(3)),
      );
      expect(
        ((card.decoration! as BoxDecoration).border! as Border).top.color,
        isNot(AppColors.terracotta),
      );

      await tester.tap(find.byKey(WeeklyPlanScreen.previousWeekKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(WeeklyPlanScreen.previousWeekKey));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(WeeklyPlanScreen.weekRangeKey)).data,
        '5 – 11 Oct',
      );
    });

    testWidgets('a range crossing a month names both months', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(
        tester,
        menuRepository: repository,
        today: DateTime.utc(2026, 10, 28),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(WeeklyPlanScreen.weekRangeKey)).data,
        '26 Oct – 1 Nov',
      );
    });
  });

  group('WeeklyPlanScreen layout by planned meals', () {
    testWidgets('four meals render the 2x2 block with no header row', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(
        tester,
        menuRepository: repository,
        household: testMenuHouseholdAllMeals,
      );
      await tester.pumpAndSettle();

      expect(find.byKey(WeeklyPlanGrid.blockLayoutKey), findsOneWidget);
      double top(MealType m) =>
          tester.getTopLeft(find.byKey(WeeklyPlanGrid.cellKey(0, m))).dy;
      double left(MealType m) =>
          tester.getTopLeft(find.byKey(WeeklyPlanGrid.cellKey(0, m))).dx;
      expect(top(MealType.breakfast), top(MealType.lunch));
      expect(top(MealType.snacks), top(MealType.dinner));
      expect(top(MealType.snacks), greaterThan(top(MealType.breakfast)));
      expect(left(MealType.snacks), left(MealType.breakfast));
      expect(left(MealType.dinner), left(MealType.lunch));
    });

    testWidgets('three meals render columns with exactly three headers', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(WeeklyPlanGrid.columnLayoutKey), findsOneWidget);
      for (final MealType m in <MealType>[
        MealType.breakfast,
        MealType.lunch,
        MealType.dinner,
      ]) {
        expect(find.byKey(WeeklyPlanGrid.columnHeaderKey(m)), findsOneWidget);
      }
      expect(
        find.byKey(WeeklyPlanGrid.columnHeaderKey(MealType.snacks)),
        findsNothing,
      );
      expect(
        find.byKey(WeeklyPlanGrid.cellKey(0, MealType.snacks)),
        findsNothing,
      );
    });

    testWidgets(
      'a Lunch configured {carb 2, sabzi_dal 3, accompaniment 2} is one cell; '
      'tapping targets the next empty slot',
      (WidgetTester tester) async {
        final Menu menu = _menuWith(<MenuItem>[
          _lunchItem('c1', RecipeRole.carb),
          _lunchItem('c2', RecipeRole.carb),
        ], household: testMenuHouseholdWideLunch);
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menu,
        );
        await _pump(
          tester,
          menuRepository: repository,
          household: testMenuHouseholdWideLunch,
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(WeeklyPlanGrid.cellKey(0, MealType.lunch)),
          findsOneWidget,
        );
        await tester.tap(find.byKey(WeeklyPlanGrid.cellKey(0, MealType.lunch)));
        await tester.pumpAndSettle();

        expect(_picker(tester).extra.mealSlot, 'lunch');
        expect(_picker(tester).extra.slotRole.wireValue, 'sabzi_dal');
      },
    );

    testWidgets('tapping an empty Dinner cell opens the picker for dinner', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(WeeklyPlanGrid.cellKey(0, MealType.dinner)));
      await tester.pumpAndSettle();

      expect(_picker(tester).extra.dayOfWeek, 0);
      expect(_picker(tester).extra.mealSlot, 'dinner');
      expect(_picker(tester).extra.slotRole.wireValue, 'carb');
    });

    testWidgets('the loading and error states render no grid', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository loadingRepository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: loadingRepository);
      expect(find.byKey(WeeklyPlanScreen.loadingKey), findsOneWidget);
      expect(find.byType(WeeklyPlanGrid), findsNothing);

      final FakeMenuRepository errorRepository = FakeMenuRepository(
        fetchError: const ForbiddenError('Not a member.'),
        createError: const ForbiddenError('Not a member.'),
      );
      await _pump(tester, menuRepository: errorRepository);
      await tester.pumpAndSettle();
      expect(find.byKey(WeeklyPlanScreen.errorKey), findsOneWidget);
      expect(find.byType(WeeklyPlanGrid), findsNothing);
    });

    testWidgets('no label anywhere names Sweet or Drink', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(
        tester,
        menuRepository: repository,
        household: testMenuHouseholdAllMeals,
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Sweet'), findsNothing);
      expect(find.textContaining('Drink'), findsNothing);
    });

    testWidgets('renders at 320 pt wide without overflow', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(
        tester,
        menuRepository: repository,
        household: testMenuHouseholdAllMeals,
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byKey(WeeklyPlanScreen.autoFillButtonKey), findsOneWidget);
    });
  });

  group('WeeklyPlanScreen reads the menu\'s own config snapshot (W14 S4)', () {
    HouseholdSettings settingsWith(List<String> meals) => HouseholdSettings(
      householdId: testMenuHousehold.settings.householdId,
      mealsEnabled: meals,
      mealStructureJson: testMenuHousehold.settings.mealStructureJson,
      cuisineTier1: testMenuHousehold.settings.cuisineTier1,
      cuisineTier2WeightsJson:
          testMenuHousehold.settings.cuisineTier2WeightsJson,
      dietaryTags: testMenuHousehold.settings.dietaryTags,
      allergens: testMenuHousehold.settings.allergens,
      skipIngredients: testMenuHousehold.settings.skipIngredients,
    );

    Household householdWith(HouseholdSettings settings) => Household(
      id: testMenuHousehold.id,
      name: testMenuHousehold.name,
      inviteCode: testMenuHousehold.inviteCode,
      primaryUserId: testMenuHousehold.primaryUserId,
      subscriptionStatus: testMenuHousehold.subscriptionStatus,
      settings: settings,
      members: testMenuHousehold.members,
    );

    testWidgets(
      "the grid renders from the menu's snapshot, not the household's live "
      'settings, when the two disagree',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: _menuWith(
            const <MenuItem>[],
            household: testMenuHouseholdAllMeals,
          ),
        );

        await _pump(
          tester,
          menuRepository: repository,
          household: householdWith(settingsWith(const <String>['breakfast'])),
          syncMenuSnapshotToHousehold: false,
        );
        await tester.pumpAndSettle();

        expect(find.byKey(WeeklyPlanGrid.blockLayoutKey), findsOneWidget);
        for (final MealType m in MealType.values) {
          expect(
            find.byKey(WeeklyPlanGrid.cellKey(0, m)),
            findsOneWidget,
            reason: m.name,
          );
        }
      },
    );

    testWidgets(
      'a snapshot with Snacks disabled renders no Snacks cell even when the '
      'live household settings enable it',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );

        await _pump(
          tester,
          menuRepository: repository,
          household: testMenuHouseholdAllMeals,
          syncMenuSnapshotToHousehold: false,
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(WeeklyPlanGrid.cellKey(0, MealType.snacks)),
          findsNothing,
        );
        expect(find.byKey(WeeklyPlanGrid.blockLayoutKey), findsNothing);
      },
    );

    testWidgets(
      'a snapshot with Snacks enabled renders a Snacks cell even when the '
      'live household settings disable it',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: _menuWith(
            const <MenuItem>[],
            household: testMenuHouseholdAllMeals,
          ),
        );

        await _pump(
          tester,
          menuRepository: repository,
          syncMenuSnapshotToHousehold: false,
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(WeeklyPlanGrid.cellKey(0, MealType.snacks)),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'a malformed snapshot degrades to a no-meals message rather than throwing',
      (WidgetTester tester) async {
        final Menu menuWithCorruptSnapshot = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
          mealConfigSnapshot: 'not valid json{',
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuWithCorruptSnapshot,
        );

        await _pump(
          tester,
          menuRepository: repository,
          syncMenuSnapshotToHousehold: false,
        );
        await tester.pumpAndSettle();

        expect(find.byKey(WeeklyPlanScreen.errorKey), findsNothing);
        expect(find.byType(WeeklyPlanGrid), findsOneWidget);
        expect(find.text('No meals configured for this week.'), findsOneWidget);
      },
    );
  });
}
