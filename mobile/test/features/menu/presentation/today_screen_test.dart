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
}
