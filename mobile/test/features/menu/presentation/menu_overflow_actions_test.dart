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
import 'package:mobile/features/menu/presentation/clear_copy_confirm_dialog.dart';
import 'package:mobile/features/menu/presentation/day_overflow_menu.dart';
import 'package:mobile/features/menu/presentation/week_overflow_menu.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_screen.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_menu_repository.dart';
import '../../../support/fake_recipe_repository.dart';
import '../../../support/menu_fixtures.dart';

/// W14 S8 (E2E_MVP_PLAN.md §20.2.8/§20.3) — confirm-gating coverage for the
/// four `WeeklyPlanScreen` affordances: "Clear week"/"Copy to next week"
/// (week-level Overflow, `WeekOverflowMenu`) and "Clear day"/"Copy to next
/// day" (per-day Overflow, `DayOverflowMenu`, exercised here on Monday —
/// `dayOfWeek: 0`, the first `_DaySection` rendered without scrolling).
///
/// Every scenario below follows the same RED-list shape (S8's own list):
/// each action is reachable only behind a confirm step; confirming issues
/// EXACTLY ONE mutation call; a partial result (`skippedCount`/
/// `preservedCount` > 0) surfaces its honest counts via `SnackBar`;
/// cancelling the confirm dialog calls nothing.
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
      recipeRepositoryProvider.overrideWithValue(
        FakeRecipeRepository(result: const <Recipe>[]),
      ),
    ],
  );
  addTearDown(container.dispose);
  await container.read(meHouseholdsControllerProvider.future);

  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.weeklyPlan,
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.weeklyPlan,
        builder: (BuildContext context, GoRouterState state) =>
            const WeeklyPlanScreen(),
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

/// The fixture menu's own `weekStartDate` must match the screen's own
/// "current week" read (same reasoning `weekly_plan_screen_test.dart`'s own
/// header comment gives for `testMenuItem`'s `dayOfWeek`).
Menu _currentWeekMenu() => Menu(
  id: 'menu-1',
  householdId: testMenuHousehold.id,
  weekStartDate: currentWeekStartDate(),
  items: const <MenuItem>[],
);

void main() {
  group('WeekOverflowMenu (W14 S8)', () {
    testWidgets('Clear week is confirm-gated: cancelling calls nothing', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: _currentWeekMenu(),
        clearWeekResult: const ClearMenuResult(
          clearedCount: 3,
          preservedCount: 1,
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(WeeklyPlanScreen.weekOverflowButtonKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(WeekOverflowMenu.clearWeekRowKey));
      await tester.pumpAndSettle();

      expect(find.byType(ClearCopyConfirmDialog), findsOneWidget);
      await tester.tap(find.byKey(ClearCopyConfirmDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(repository.clearWeekCalls, isEmpty);
    });

    testWidgets(
      'Clear week: confirming issues exactly one clearMenuWeek call and surfaces the honest partial-result counts',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: _currentWeekMenu(),
          clearWeekResult: const ClearMenuResult(
            clearedCount: 3,
            preservedCount: 1,
          ),
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(WeeklyPlanScreen.weekOverflowButtonKey));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(WeekOverflowMenu.clearWeekRowKey));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(ClearCopyConfirmDialog.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(repository.clearWeekCalls, hasLength(1));
        expect(repository.clearWeekCalls.single, 'menu-1');
        // The honest partial result (1 preserved because it was cooked)
        // surfaces to the user, never silently rounded up to "all cleared".
        expect(find.text('Cleared 3, kept 1 already made.'), findsOneWidget);
      },
    );

    testWidgets(
      'Copy to next week is confirm-gated: cancelling calls nothing',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: _currentWeekMenu(),
          copyWeekResult: CopyMenuResult(
            menu: _currentWeekMenu(),
            copiedCount: 2,
            skippedCount: 0,
          ),
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(WeeklyPlanScreen.weekOverflowButtonKey));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(WeekOverflowMenu.copyToNextWeekRowKey));
        await tester.pumpAndSettle();

        expect(find.byType(ClearCopyConfirmDialog), findsOneWidget);
        await tester.tap(find.byKey(ClearCopyConfirmDialog.cancelButtonKey));
        await tester.pumpAndSettle();

        expect(repository.copyWeekCalls, isEmpty);
      },
    );

    testWidgets(
      'Copy to next week: confirming issues exactly one copyMenuWeek call, targeting +7 days, and surfaces skippedCount honestly',
      (WidgetTester tester) async {
        final Menu currentWeekMenu = _currentWeekMenu();
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: currentWeekMenu,
          copyWeekResult: CopyMenuResult(
            menu: currentWeekMenu,
            copiedCount: 5,
            skippedCount: 2,
          ),
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(WeeklyPlanScreen.weekOverflowButtonKey));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(WeekOverflowMenu.copyToNextWeekRowKey));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(ClearCopyConfirmDialog.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(repository.copyWeekCalls, hasLength(1));
        final (String fromMenuId, DateTime toWeekStartDate) =
            repository.copyWeekCalls.single;
        expect(fromMenuId, 'menu-1');
        expect(
          toWeekStartDate,
          currentWeekMenu.weekStartDate.add(const Duration(days: 7)),
        );
        expect(find.text('Copied 5, skipped 2.'), findsOneWidget);
      },
    );
  });

  group('DayOverflowMenu (W14 S8)', () {
    testWidgets('Clear day is confirm-gated: cancelling calls nothing', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: _currentWeekMenu(),
        clearDayResult: const ClearMenuResult(
          clearedCount: 2,
          preservedCount: 0,
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      // Monday's own section is the first one rendered.
      await tester.tap(find.byKey(Key('day-section-overflow-0')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DayOverflowMenu.clearDayRowKey));
      await tester.pumpAndSettle();

      expect(find.byType(ClearCopyConfirmDialog), findsOneWidget);
      await tester.tap(find.byKey(ClearCopyConfirmDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(repository.clearDayCalls, isEmpty);
    });

    testWidgets(
      'Clear day: confirming issues exactly one clearMenuDay(0) call and surfaces the honest counts',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: _currentWeekMenu(),
          clearDayResult: const ClearMenuResult(
            clearedCount: 2,
            preservedCount: 1,
          ),
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(Key('day-section-overflow-0')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(DayOverflowMenu.clearDayRowKey));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(ClearCopyConfirmDialog.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(repository.clearDayCalls, hasLength(1));
        expect(repository.clearDayCalls.single, ('menu-1', 0));
        expect(find.text('Cleared 2, kept 1 already made.'), findsOneWidget);
      },
    );

    testWidgets('Copy to next day is confirm-gated: cancelling calls nothing', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: _currentWeekMenu(),
        copyDayResult: CopyMenuResult(
          menu: _currentWeekMenu(),
          copiedCount: 1,
          skippedCount: 0,
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(Key('day-section-overflow-0')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DayOverflowMenu.copyToNextDayRowKey));
      await tester.pumpAndSettle();

      expect(find.byType(ClearCopyConfirmDialog), findsOneWidget);
      await tester.tap(find.byKey(ClearCopyConfirmDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(repository.copyDayCalls, isEmpty);
    });

    testWidgets(
      'Copy to next day: confirming issues exactly one copyMenuDay(0, 1) call and surfaces skippedCount honestly',
      (WidgetTester tester) async {
        final FakeMenuRepository repository = FakeMenuRepository(
          fetchResult: _currentWeekMenu(),
          copyDayResult: CopyMenuResult(
            menu: _currentWeekMenu(),
            copiedCount: 1,
            skippedCount: 1,
          ),
        );
        await _pump(tester, menuRepository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(Key('day-section-overflow-0')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(DayOverflowMenu.copyToNextDayRowKey));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(ClearCopyConfirmDialog.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(repository.copyDayCalls, hasLength(1));
        // Monday (0) -> Tuesday (1), the "copy to next day" wraparound rule.
        expect(repository.copyDayCalls.single, ('menu-1', 0, 1));
        expect(find.text('Copied 1, skipped 1.'), findsOneWidget);
      },
    );
  });
}
