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
import 'package:mobile/features/menu/presentation/today_screen.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_screen.dart';
import 'package:mobile/features/menu/state/pending_mark_made_action.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/domain/recipe_source.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_menu_repository.dart';
import '../../../support/menu_fixtures.dart';

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeMenuRepository menuRepository,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(
          myHouseholdsResult: <Household>[testMenuHousehold],
          fetchResult: testMenuHousehold,
        ),
      ),
      menuRepositoryProvider.overrideWithValue(menuRepository),
    ],
  );
  addTearDown(container.dispose);
  await container.read(meHouseholdsControllerProvider.future);

  // Same minimal-real-router reasoning as `weekly_plan_screen_test.dart`'s
  // own `_pump` — `TodayScreen` navigates via `context.go`/`context.push`.
  final GoRouter router = GoRouter(
    initialLocation: '/home',
    routes: <RouteBase>[
      GoRoute(
        path: '/home',
        builder: (BuildContext context, GoRouterState state) =>
            const TodayScreen(),
      ),
      GoRoute(
        path: AppRoutes.weeklyPlan,
        builder: (BuildContext context, GoRouterState state) =>
            const WeeklyPlanScreen(),
      ),
      GoRoute(
        path: AppRoutes.settingsHubPattern,
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('Settings hub stub')),
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

/// `TodayScreen` filters by the REAL current weekday (`DateTime.now()`, via
/// `todaysItems`'s own default) — not a fixed day — so fixture items must
/// target whatever day "today" actually is when the suite runs, not a
/// hardcoded Monday.
final int _todayDayOfWeek = DateTime.now().weekday - 1;

MenuItem _item(String id, String mealSlot, RecipeRole role, String title) =>
    MenuItem(
      id: id,
      menuId: 'menu-1',
      recipe: Recipe(
        id: 'recipe-$id',
        householdId: 'household-1',
        sourceType: RecipeSource.user,
        title: title,
        servings: 4,
        dietaryTags: const <String>[],
        role: role,
        inRotation: true,
        isFavorite: false,
        steps: const <String>[],
        createdAt: DateTime.utc(2026, 9, 1),
        updatedAt: DateTime.utc(2026, 9, 1),
      ),
      dayOfWeek: _todayDayOfWeek,
      mealSlot: mealSlot,
      slotRole: role,
    );

void main() {
  group('TodayScreen', () {
    testWidgets('shows a loading indicator before the menu resolves', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);

      expect(find.byKey(TodayScreen.loadingKey), findsOneWidget);
    });

    testWidgets('a load failure is distinguished from a genuinely-empty day', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchError: const ForbiddenError('Not a member.'),
        createError: const ForbiddenError('Not a member.'),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(TodayScreen.errorKey), findsOneWidget);
      expect(find.byKey(TodayScreen.emptyStateKey), findsNothing);
      expect(find.text('Not a member.'), findsOneWidget);
    });

    testWidgets(
      'an empty day renders the real empty state, with a link to Weekly plan — not a blank screen',
      (WidgetTester tester) async {
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: const <MenuItem>[],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        expect(find.byKey(TodayScreen.emptyStateKey), findsOneWidget);
        expect(find.byKey(TodayScreen.errorKey), findsNothing);

        await tester.tap(find.text('Go to Weekly plan'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.byType(WeeklyPlanScreen), findsOneWidget);
      },
    );

    testWidgets(
      'a non-empty day renders every item for today, in meal-type order',
      (WidgetTester tester) async {
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[
            _item('dinner-item', 'dinner', RecipeRole.sabziDal, 'Dal'),
            _item('breakfast-item', 'breakfast', RecipeRole.breakfast, 'Poha'),
            _item('lunch-item', 'lunch', RecipeRole.carb, 'Roti'),
          ],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        expect(find.byKey(TodayScreen.emptyStateKey), findsNothing);
        expect(find.text('Poha'), findsOneWidget);
        expect(find.text('Roti'), findsOneWidget);
        expect(find.text('Dal'), findsOneWidget);

        // breakfast → lunch → snacks → dinner order, not insertion order
        // (items were added dinner, breakfast, lunch) — asserted via each
        // title's own vertical position in the list.
        final double poha = tester.getTopLeft(find.text('Poha')).dy;
        final double roti = tester.getTopLeft(find.text('Roti')).dy;
        final double dal = tester.getTopLeft(find.text('Dal')).dy;
        expect(poha, lessThan(roti));
        expect(roti, lessThan(dal));
      },
    );

    testWidgets('the settings gear reaches the Settings hub', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(TodayScreen.settingsButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('Settings hub stub'), findsOneWidget);
    });
  });

  // ── "Mark as made" — single tap + undo (D8/O5, §18.2.8/§18.3 S5) ────────

  group('TodayScreen — Mark as made', () {
    testWidgets(
      'tapping the affordance immediately shows the made state and the '
      'undo snackbar, WITHOUT calling markMade yet',
      (WidgetTester tester) async {
        final MenuItem item = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        expect(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
          findsOneWidget,
        );
        expect(
          find.byKey(TodayScreen.madeBadgeKey('dinner-item')),
          findsNothing,
        );

        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();

        // Optimistic made state shows immediately.
        expect(
          find.byKey(TodayScreen.madeBadgeKey('dinner-item')),
          findsOneWidget,
        );
        expect(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
          findsNothing,
        );
        // The undo snackbar shows immediately too.
        expect(find.text('Marked as made'), findsOneWidget);
        expect(find.text('Undo'), findsOneWidget);

        // The core D8 regression: markMade has NOT been called yet.
        expect(repository.markMadeCalls, isEmpty);
      },
    );

    testWidgets(
      'tapping Undo within the window cancels the pending action, reverts '
      'the item, and markMade is never called at all',
      (WidgetTester tester) async {
        final MenuItem item = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();
        // Lets the snackbar's entrance animation finish so "Undo" is
        // actually hit-testable at its settled position, not mid-slide.
        await tester.pump(const Duration(milliseconds: 300));

        await tester.tap(find.text('Undo'));
        await tester.pump();

        expect(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
          findsOneWidget,
        );
        expect(
          find.byKey(TodayScreen.madeBadgeKey('dinner-item')),
          findsNothing,
        );

        // Let the original window fully elapse — still never called.
        await tester.pump(PendingMarkMadeAction.defaultPendingWindow);
        await tester.pump(const Duration(seconds: 1));

        expect(repository.markMadeCalls, isEmpty);
      },
    );

    testWidgets(
      'tapping Undo also dismisses its own toast immediately — no lingering '
      'now-inert "Undo" control (code-reviewer finding)',
      (WidgetTester tester) async {
        final MenuItem item = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        await tester.tap(find.text('Undo'));
        // A single frame — not `pumpAndSettle` — so this asserts the toast
        // is gone (or at least closing) right away, not merely eventually.
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.byType(SnackBar), findsNothing);
      },
    );

    testWidgets(
      'marking a second item made while the first item\'s toast is still '
      'showing does not silently queue the second toast behind it — it '
      'shows immediately (code-reviewer finding: a queued toast could '
      'otherwise eat the second item\'s own undo window before the user '
      'ever sees it)',
      (WidgetTester tester) async {
        final MenuItem breakfastItem = _item(
          'breakfast-item',
          'breakfast',
          RecipeRole.breakfast,
          'Poha',
        );
        final MenuItem dinnerItem = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[breakfastItem, dinnerItem],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
          // Both deferred commits below must succeed cleanly — this test
          // is about toast VISIBILITY, not the error-revert path (covered
          // elsewhere).
          markMadeResult: breakfastItem,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('breakfast-item')),
        );
        await tester.pump();

        // Immediately (same frame's follow-up, no settle for a full
        // snackbar cycle) mark a second item made.
        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();

        // Exactly one SnackBar exists — the second tap's own toast is
        // shown right away rather than silently queued invisible behind
        // the first's.
        expect(find.byType(SnackBar), findsOneWidget);

        await tester.pump(PendingMarkMadeAction.defaultPendingWindow);
        await tester.pumpAndSettle();

        // Both deferred commits still fire correctly — the toast queueing
        // fix only changes what's VISIBLE, not the underlying pending
        // actions themselves.
        expect(
          repository.markMadeCalls,
          containsAll(<String>['breakfast-item', 'dinner-item']),
        );
        expect(repository.markMadeCalls.length, 2);
      },
    );

    testWidgets(
      'letting the window elapse without tapping Undo fires the deferred '
      'markMade call with the correct menuItemId',
      (WidgetTester tester) async {
        final MenuItem item = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final MenuItem madeItem = MenuItem(
          id: item.id,
          menuId: item.menuId,
          recipe: item.recipe,
          dayOfWeek: item.dayOfWeek,
          mealSlot: item.mealSlot,
          slotRole: item.slotRole,
          madeAt: DateTime.utc(2026, 9, 4),
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
          markMadeResult: madeItem,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();

        await tester.pump(PendingMarkMadeAction.defaultPendingWindow);
        await tester.pumpAndSettle();

        expect(repository.markMadeCalls, <String>['dinner-item']);
      },
    );

    testWidgets(
      'an already-madeAt-set item renders the made state on initial load, '
      'not a tappable affordance',
      (WidgetTester tester) async {
        final MenuItem item = MenuItem(
          id: 'dinner-item',
          menuId: 'menu-1',
          recipe: _item(
            'dinner-item',
            'dinner',
            RecipeRole.sabziDal,
            'Dal',
          ).recipe,
          dayOfWeek: _todayDayOfWeek,
          mealSlot: 'dinner',
          slotRole: RecipeRole.sabziDal,
          madeAt: DateTime.utc(2026, 9, 3),
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        expect(
          find.byKey(TodayScreen.madeBadgeKey('dinner-item')),
          findsOneWidget,
        );
        expect(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'a failed deferred markMade reverts the optimistic state and shows '
      'a visible error',
      (WidgetTester tester) async {
        final MenuItem item = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
          markMadeError: const ConflictError('Already made.'),
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();

        await tester.pump(PendingMarkMadeAction.defaultPendingWindow);
        await tester.pumpAndSettle();

        expect(repository.markMadeCalls, <String>['dinner-item']);
        // Reverted — the affordance is back, not the made badge.
        expect(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
          findsOneWidget,
        );
        expect(
          find.byKey(TodayScreen.madeBadgeKey('dinner-item')),
          findsNothing,
        );
        expect(find.text('Already made.'), findsOneWidget);
      },
    );

    testWidgets(
      'a second tap while an action is already pending for the item is a '
      'no-op — not a second scheduled call',
      (WidgetTester tester) async {
        final MenuItem item = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final MenuItem madeItem = MenuItem(
          id: item.id,
          menuId: item.menuId,
          recipe: item.recipe,
          dayOfWeek: item.dayOfWeek,
          mealSlot: item.mealSlot,
          slotRole: item.slotRole,
          madeAt: DateTime.utc(2026, 9, 4),
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
          markMadeResult: madeItem,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        // Two taps on the SAME still-rendered button, back to back, before
        // any `pump()` runs a rebuild in between — this is what "a second
        // tap while an action is already pending" means directly: both
        // taps reach `_startMarkMade` against the pre-rebuild tree, the
        // second one landing while `_pending` is already non-null from the
        // first. The locked behaviour (this class's own doc,
        // `pending_mark_made_action.dart`) is a no-op — the first tap's
        // pending action governs, unextended.
        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();

        // Now reflects the optimistic made state — the affordance no
        // longer offered, matching "an already-made item ... doesn't offer
        // the affordance" (this applies to this tap's own optimistic
        // state too, not only a prior real commit).
        expect(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
          findsNothing,
        );
        expect(
          find.byKey(TodayScreen.madeBadgeKey('dinner-item')),
          findsOneWidget,
        );

        await tester.pump(PendingMarkMadeAction.defaultPendingWindow);
        await tester.pumpAndSettle();

        // Exactly one call reached the repository — the double tap did NOT
        // schedule (and later fire) a second deferred commit.
        expect(repository.markMadeCalls, <String>['dinner-item']);
      },
    );

    testWidgets(
      'marking one item made does not disturb a sibling item pending on '
      'the same screen (flutter-reviewer finding — no positional reuse of '
      'live per-item state)',
      (WidgetTester tester) async {
        final MenuItem breakfastItem = _item(
          'breakfast-item',
          'breakfast',
          RecipeRole.breakfast,
          'Poha',
        );
        final MenuItem dinnerItem = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          // Deliberately inserted out of the breakfast→dinner display
          // order `todaysItems` sorts to, so a positional (index-based)
          // widget reconciliation bug would reassign state across a
          // reorder exactly like this one.
          items: <MenuItem>[dinnerItem, breakfastItem],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        // Mark the breakfast item made — it goes optimistic-made and
        // pending.
        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('breakfast-item')),
        );
        await tester.pump();

        expect(
          find.byKey(TodayScreen.madeBadgeKey('breakfast-item')),
          findsOneWidget,
        );
        // The dinner item is untouched — still its own tappable affordance,
        // not swept into the breakfast item's optimistic state by a stale
        // (positionally-reused) `_TodayItemCardState`.
        expect(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
          findsOneWidget,
        );
        expect(
          find.byKey(TodayScreen.madeBadgeKey('dinner-item')),
          findsNothing,
        );

        await tester.pump(PendingMarkMadeAction.defaultPendingWindow);
        await tester.pumpAndSettle();

        // Only the breakfast item's own id reached the repository —
        // never the dinner item's.
        expect(repository.markMadeCalls, <String>['breakfast-item']);
      },
    );

    testWidgets(
      'navigating away mid-window cancels the pending action — no crash, '
      'no late repository call',
      (WidgetTester tester) async {
        final MenuItem item = _item(
          'dinner-item',
          'dinner',
          RecipeRole.sabziDal,
          'Dal',
        );
        final Menu menuForToday = Menu(
          id: 'menu-1',
          householdId: 'household-1',
          weekStartDate: currentWeekStartDate(),
          items: <MenuItem>[item],
        );
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: menuForToday,
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(TodayScreen.markMadeButtonKey('dinner-item')),
        );
        await tester.pump();

        // Navigate away from Today — `_TodayItemCard` (and its pending
        // action's owning State) is disposed mid-window.
        await tester.tap(find.byKey(TodayScreen.settingsButtonKey));
        await tester.pumpAndSettle();
        expect(find.text('Settings hub stub'), findsOneWidget);

        // Letting the original window elapse must not throw (no
        // setState-after-dispose) and must not fire the deferred commit —
        // `State.dispose` cancels the pending action (this class's own
        // `dispose` doc).
        await tester.pump(PendingMarkMadeAction.defaultPendingWindow);
        await tester.pumpAndSettle();

        expect(repository.markMadeCalls, isEmpty);
        expect(tester.takeException(), isNull);
      },
    );
  });
}
