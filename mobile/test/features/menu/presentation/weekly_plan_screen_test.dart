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
          mealConfigSnapshot: mealConfigSnapshotJsonFor(
            testMenuHousehold.settings,
          ),
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

  group('WeeklyPlanScreen meal-instance headers (W13 S5)', () {
    testWidgets(
      'a day with all four meals enabled renders four headers, in Breakfast → Lunch → Snacks → Dinner order',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(
          tester,
          menuRepository: repository,
          household: testMenuHouseholdAllMeals,
        );
        await tester.pumpAndSettle();

        // Monday is dayOfWeek 0, and the first section built without
        // scrolling — same convention the existing "9 slots" test above
        // relies on.
        final List<MealType> expectedOrder = <MealType>[
          MealType.breakfast,
          MealType.lunch,
          MealType.snacks,
          MealType.dinner,
        ];
        final List<Finder> headerFinders = expectedOrder
            .map(
              (MealType type) =>
                  find.byKey(MealInstanceHeader.headerKey(0, type)),
            )
            .toList();

        for (final Finder finder in headerFinders) {
          expect(finder, findsOneWidget);
        }

        // Order, not just presence: each header's own vertical position on
        // Monday's section must ascend Breakfast → Lunch → Snacks →
        // Dinner, matching MealType.values' own declaration order.
        final List<double> headerTops = headerFinders
            .map((Finder finder) => tester.getTopLeft(finder).dy)
            .toList();
        for (int i = 1; i < headerTops.length; i++) {
          expect(headerTops[i], greaterThan(headerTops[i - 1]));
        }
      },
    );

    testWidgets(
      'a household with Snacks disabled renders three headers and no Snacks header anywhere',
      (WidgetTester tester) async {
        // testMenuHousehold's own mealsEnabled is breakfast/lunch/dinner —
        // Snacks deliberately absent, exercising this without a bespoke
        // fixture.
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.breakfast)),
          findsOneWidget,
        );
        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.lunch)),
          findsOneWidget,
        );
        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.dinner)),
          findsOneWidget,
        );
        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.snacks)),
          findsNothing,
        );
        // No Snacks header anywhere in the tree, not just at this key —
        // asserted against the header's own display text too, across
        // every day the ListView has built so far.
        expect(
          find.widgetWithText(MealInstanceHeader, 'Snacks'),
          findsNothing,
        );
      },
    );

    testWidgets(
      'a Lunch group configured {carb: 2, sabzi_dal: 3, accompaniment: 2} renders seven slot cards under Lunch and none under any other header',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(
          tester,
          menuRepository: repository,
          household: testMenuHouseholdWideLunch,
        );
        await tester.pumpAndSettle();

        // Monday's Breakfast contributes 1 slot, Dinner's default
        // structure (unchanged by this fixture) contributes 4 — the widened
        // Lunch group is the ONLY variable, so the total slot count on
        // Monday pins it precisely: 1 (breakfast) + 7 (lunch) + 4 (dinner)
        // = 12.
        expect(find.byType(MealSlotCard), findsNWidgets(12));

        final Finder lunchHeader = find.byKey(
          MealInstanceHeader.headerKey(0, MealType.lunch),
        );
        expect(lunchHeader, findsOneWidget);
        final double lunchHeaderTop = tester.getTopLeft(lunchHeader).dy;
        final double dinnerHeaderTop = tester
            .getTopLeft(
              find.byKey(MealInstanceHeader.headerKey(0, MealType.dinner)),
            )
            .dy;

        // Every MealSlotCard strictly between Lunch's own header and
        // Dinner's own header belongs to the Lunch group — count them
        // directly rather than trusting the domain module's own unit test
        // to cover this screen's wiring too.
        final Iterable<Element> allCards = find
            .byType(MealSlotCard)
            .evaluate();
        final int cardsUnderLunch = allCards.where((Element element) {
          final double top = (element.renderObject! as RenderBox)
              .localToGlobal(Offset.zero)
              .dy;
          return top > lunchHeaderTop && top < dinnerHeaderTop;
        }).length;
        expect(cardsUnderLunch, 7);
      },
    );

    testWidgets(
      'tapping an empty slot under Dinner still opens the picker with mealSlot: dinner and the correct slotRole',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        // Dinner's own first slot instance, addressed directly via
        // `MealSlotCard.emptyKey` rather than positional indexing into
        // `find.byType(MealSlotCard)` — the grouping must not change what
        // a tap means, and this is the direct regression for that.
        final Finder dinnerCarbSlot = find.byKey(
          MealSlotCard.emptyKey(0, 'dinner', 'carb', 0),
        );
        expect(dinnerCarbSlot, findsOneWidget);
        await tester.ensureVisible(dinnerCarbSlot);
        await tester.pumpAndSettle();

        await tester.tap(dinnerCarbSlot);
        await tester.pumpAndSettle();

        expect(find.byType(RecipePickerScreen), findsOneWidget);
        final RecipePickerScreen picker = tester.widget(
          find.byType(RecipePickerScreen),
        );
        expect(picker.extra.dayOfWeek, 0);
        expect(picker.extra.mealSlot, 'dinner');
        expect(picker.extra.slotRole.wireValue, 'carb');
      },
    );

    testWidgets(
      'a filled slot still renders its recipe under its own meal header and still routes on tap',
      (WidgetTester tester) async {
        final Menu menuWithMondayItem = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[testMenuItem],
          mealConfigSnapshot: mealConfigSnapshotJsonFor(
            testMenuHousehold.settings,
          ),
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

        // testMenuItem is mealSlot: lunch — it must render UNDER the Lunch
        // header, below it and above Dinner's.
        final double filledCardTop = tester.getTopLeft(filledCard).dy;
        final double lunchHeaderTop = tester
            .getTopLeft(
              find.byKey(MealInstanceHeader.headerKey(0, MealType.lunch)),
            )
            .dy;
        final double dinnerHeaderTop = tester
            .getTopLeft(
              find.byKey(MealInstanceHeader.headerKey(0, MealType.dinner)),
            )
            .dy;
        expect(filledCardTop, greaterThan(lunchHeaderTop));
        expect(filledCardTop, lessThan(dinnerHeaderTop));

        await tester.tap(filledCard);
        await tester.pumpAndSettle();
        expect(find.byType(RecipePickerScreen), findsNothing);
      },
    );

    testWidgets(
      'the loading/error/empty states are unchanged by the grouping',
      (WidgetTester tester) async {
        final FakeMenuRepository loadingRepository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(tester, menuRepository: loadingRepository);
        expect(find.byKey(WeeklyPlanScreen.loadingKey), findsOneWidget);

        final FakeMenuRepository errorRepository = FakeMenuRepository(
          fetchError: const ForbiddenError('Not a member.'),
          createError: const ForbiddenError('Not a member.'),
        );
        await _pump(tester, menuRepository: errorRepository);
        await tester.pumpAndSettle();
        expect(find.byKey(WeeklyPlanScreen.errorKey), findsOneWidget);
        expect(find.byType(MealInstanceHeader), findsNothing);
      },
    );

    testWidgets(
      'no header or label anywhere in the tree names Sweet or Drink',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: testEmptyMenu,
        );
        await _pump(
          tester,
          menuRepository: repository,
          household: testMenuHouseholdAllMeals,
        );
        await tester.pumpAndSettle();

        expect(find.text('Sweet'), findsNothing);
        expect(find.text('Drink'), findsNothing);
        expect(find.widgetWithText(MealInstanceHeader, 'Sweet'), findsNothing);
        expect(find.widgetWithText(MealInstanceHeader, 'Drink'), findsNothing);
      },
    );
  });

  group('WeeklyPlanScreen reads the menu\'s own config snapshot (W14 S4)', () {
    testWidgets(
      'the grid renders from the menu\'s snapshot, not from the household\'s live settings, when the two disagree',
      (WidgetTester tester) async {
        // Live settings: only breakfast. The menu's own snapshot: all four
        // meals. If the grid were still reading `household.settings` (the
        // pre-S4 behavior), only Breakfast would render — asserting Lunch/
        // Snacks/Dinner headers here is the direct regression for "reads
        // the snapshot, not the live household".
        final HouseholdSettings liveSettingsBreakfastOnly = HouseholdSettings(
          householdId: testMenuHousehold.settings.householdId,
          mealsEnabled: const <String>['breakfast'],
          mealStructureJson: testMenuHousehold.settings.mealStructureJson,
          cuisineTier1: testMenuHousehold.settings.cuisineTier1,
          cuisineTier2WeightsJson:
              testMenuHousehold.settings.cuisineTier2WeightsJson,
          dietaryTags: testMenuHousehold.settings.dietaryTags,
          allergens: testMenuHousehold.settings.allergens,
          skipIngredients: testMenuHousehold.settings.skipIngredients,
        );
        final Household householdWithMismatchedLiveSettings = Household(
          id: testMenuHousehold.id,
          name: testMenuHousehold.name,
          inviteCode: testMenuHousehold.inviteCode,
          primaryUserId: testMenuHousehold.primaryUserId,
          subscriptionStatus: testMenuHousehold.subscriptionStatus,
          settings: liveSettingsBreakfastOnly,
          members: testMenuHousehold.members,
        );
        final Menu menuWithAllFourMealsSnapshot = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
          mealConfigSnapshot: mealConfigSnapshotJsonFor(
            testMenuHouseholdAllMeals.settings,
          ),
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuWithAllFourMealsSnapshot,
        );

        await _pump(
          tester,
          menuRepository: repository,
          household: householdWithMismatchedLiveSettings,
          syncMenuSnapshotToHousehold: false,
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.breakfast)),
          findsOneWidget,
        );
        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.lunch)),
          findsOneWidget,
        );
        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.snacks)),
          findsOneWidget,
        );
        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.dinner)),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'a snapshot with Snacks disabled renders no Snacks header even when the live household settings enable it',
      (WidgetTester tester) async {
        // Live settings (testMenuHouseholdAllMeals): Snacks ENABLED.
        // Snapshot (testMenuHousehold's, via the default menu fixture):
        // Snacks DISABLED. The grid must follow the snapshot.
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
          find.byKey(MealInstanceHeader.headerKey(0, MealType.snacks)),
          findsNothing,
        );
        expect(
          find.widgetWithText(MealInstanceHeader, 'Snacks'),
          findsNothing,
        );
      },
    );

    testWidgets(
      'a snapshot with Snacks enabled renders a Snacks header even when the live household settings disable it',
      (WidgetTester tester) async {
        // Live settings (testMenuHousehold): Snacks DISABLED. Snapshot
        // (testMenuHouseholdAllMeals's): Snacks ENABLED. The grid must
        // follow the snapshot, the mirror image of the previous case.
        final Menu menuWithSnacksInSnapshot = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
          mealConfigSnapshot: mealConfigSnapshotJsonFor(
            testMenuHouseholdAllMeals.settings,
          ),
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuWithSnacksInSnapshot,
        );

        await _pump(
          tester,
          menuRepository: repository,
          syncMenuSnapshotToHousehold: false,
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(MealInstanceHeader.headerKey(0, MealType.snacks)),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'a malformed snapshot degrades to zero slots rather than throwing',
      (WidgetTester tester) async {
        // Not valid JSON at all — `Menu.mealConfigSettings`' own defensive
        // decode (mirroring `meal_slot_plan.dart`'s `_decodeMealStructure`
        // fail-closed posture) must degrade to an empty `mealsEnabled`
        // rather than let this propagate as an uncaught exception.
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

        // No exception surfaced (pumpAndSettle above would have rethrown
        // one), the screen itself loaded past its loading/error states, and
        // zero slots/headers render for the one malformed day.
        expect(find.byKey(WeeklyPlanScreen.errorKey), findsNothing);
        expect(find.byType(MealSlotCard), findsNothing);
        expect(find.byType(MealInstanceHeader), findsNothing);
        expect(
          find.text('No meals configured for this day.'),
          findsWidgets,
        );
      },
    );
  });
}
