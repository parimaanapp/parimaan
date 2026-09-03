import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/presentation/weekly_plan_screen.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/presentation/checklist_item.dart';
import 'package:mobile/features/shopping_list/presentation/list_generated_prompt_screen.dart';
import 'package:mobile/features/shopping_list/presentation/list_preview_screen.dart';
import 'package:mobile/features/shopping_list/presentation/notification_permission_prompt_screen.dart';
import 'package:mobile/features/shopping_list/presentation/shopping_list_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_menu_repository.dart';
import '../../../support/fake_shopping_list_repository.dart';
import '../../../support/household_route_harness.dart';
import '../../../support/menu_fixtures.dart';
import '../../../support/shopping_list_fixtures.dart';

/// Boots the REAL app router (`household_route_harness.dart`'s own
/// `pumpHouseholdRoute` — the same shape `router_test.dart` uses) landed on
/// `AppRoutes.weeklyPlan`, with the menu/shopping-list repositories faked.
/// Going through the real router — not a scoped mini-router — is what makes
/// "the notification prompt never fires during onboarding" an assertion
/// against the SAME route table onboarding itself uses, per this slice's own
/// RED-test wording ("asserted against the router/navigation stack
/// directly").
Future<HouseholdHarness> _pumpWeeklyPlan(
  WidgetTester tester, {
  required FakeMenuRepository menuRepository,
  required FakeShoppingListRepository shoppingListRepository,
}) => pumpHouseholdRoute(
  tester,
  AppRoutes.weeklyPlan,
  repository: FakeHouseholdRepository(
    myHouseholdsResult: <Household>[testMenuHousehold],
    fetchResult: testMenuHousehold,
  ),
  overrides: <Override>[
    menuRepositoryProvider.overrideWithValue(menuRepository),
    shoppingListRepositoryProvider.overrideWithValue(shoppingListRepository),
  ],
);

void main() {
  group('Shopping list generate flow (W11 S6)', () {
    testWidgets(
      'the generate affordance calls generateShoppingList with the CURRENT menu\'s id, never a stale one',
      (WidgetTester tester) async {
        final FakeMenuRepository menuRepository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
        );
        final FakeShoppingListRepository shoppingListRepository =
            FakeShoppingListRepository(generateResult: testShoppingList);

        final HouseholdHarness harness = await _pumpWeeklyPlan(
          tester,
          menuRepository: menuRepository,
          shoppingListRepository: shoppingListRepository,
        );

        await tester.tap(
          find.byKey(WeeklyPlanScreen.generateShoppingListButtonKey),
        );
        await tester.pumpAndSettle();
        expect(find.byType(ListGeneratedPromptScreen), findsOneWidget);

        await tester.tap(
          find.byKey(ListGeneratedPromptScreen.generateButtonKey),
        );
        await tester.pumpAndSettle();

        expect(find.byType(ListPreviewScreen), findsOneWidget);
        // `testMenuWithItems.id` is `menu-1` — the exact id the CURRENT
        // week's `Menu` resolved to, never a hardcoded or previously-cached
        // one.
        expect(shoppingListRepository.generateCalls, <String>[
          testMenuWithItems.id,
        ]);
        addTearDown(() => harness.container.dispose());
      },
    );

    testWidgets(
      'a fully-staples-excluded week renders a real empty state, not a blank screen',
      (WidgetTester tester) async {
        final FakeMenuRepository menuRepository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
        );
        final FakeShoppingListRepository shoppingListRepository =
            FakeShoppingListRepository(generateResult: testEmptyShoppingList);

        await _pumpWeeklyPlan(
          tester,
          menuRepository: menuRepository,
          shoppingListRepository: shoppingListRepository,
        );

        await tester.tap(
          find.byKey(WeeklyPlanScreen.generateShoppingListButtonKey),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(ListGeneratedPromptScreen.generateButtonKey),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(ListPreviewScreen.emptyKey), findsOneWidget);
        expect(find.text('Nothing to buy this week.'), findsOneWidget);
      },
    );

    testWidgets(
      'categories render in a stable, defined order, and items group correctly per category',
      (WidgetTester tester) async {
        final ShoppingListItem produceItem = ShoppingListItem(
          id: 'item-produce',
          name: 'Tomato',
          quantity: 4,
          unit: 'piece',
          category: 'produce',
          sourceRecipeId: 'recipe-1',
          purchased: false,
          purchasedBy: null,
          purchasedAt: null,
          movedToPantry: false,
        );
        final ShoppingListItem dairyItem = ShoppingListItem(
          id: 'item-dairy',
          name: 'Yogurt',
          quantity: 1,
          unit: 'packet',
          category: 'dairy',
          sourceRecipeId: 'recipe-1',
          purchased: false,
          purchasedBy: null,
          purchasedAt: null,
          movedToPantry: false,
        );
        final ShoppingList mixedList = ShoppingList(
          id: 'shopping-list-1',
          householdId: 'household-1',
          generatedFromMenuId: 'menu-1',
          createdAt: DateTime.utc(2026, 9, 1),
          closedAt: null,
          aiStaplesNote: null,
          // Dairy first in the SERVER's own response order — the client
          // must not just echo it back; the defined order puts produce
          // first regardless.
          items: <ShoppingListItem>[dairyItem, produceItem],
        );

        final FakeMenuRepository menuRepository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
        );
        final FakeShoppingListRepository shoppingListRepository =
            FakeShoppingListRepository(generateResult: mixedList);

        await _pumpWeeklyPlan(
          tester,
          menuRepository: menuRepository,
          shoppingListRepository: shoppingListRepository,
        );

        await tester.tap(
          find.byKey(WeeklyPlanScreen.generateShoppingListButtonKey),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(ListGeneratedPromptScreen.generateButtonKey),
        );
        await tester.pumpAndSettle();

        final Finder produceHeading = find.text('Produce');
        final Finder dairyHeading = find.text('Dairy');
        expect(produceHeading, findsOneWidget);
        expect(dairyHeading, findsOneWidget);

        // Produce sorts before dairy in the DEFINED order, regardless of
        // the server's own item order — assert via vertical position.
        final double produceY = tester.getTopLeft(produceHeading).dy;
        final double dairyY = tester.getTopLeft(dairyHeading).dy;
        expect(produceY, lessThan(dairyY));

        // Each item landed under its OWN category, not the other one.
        expect(
          find.byKey(ChecklistItem.rowKey('item-produce')),
          findsOneWidget,
        );
        expect(find.byKey(ChecklistItem.rowKey('item-dairy')), findsOneWidget);
      },
    );

    testWidgets('a generation failure renders inline, never a silent no-op', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository menuRepository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
      );
      final FakeShoppingListRepository shoppingListRepository =
          FakeShoppingListRepository(
            // NOT a ConflictError — that specific failure has its own,
            // deliberately DIFFERENT handling (redirect, not inline error;
            // see the test right below this one).
            generateError: const ValidationError('Could not build a list.'),
          );

      await _pumpWeeklyPlan(
        tester,
        menuRepository: menuRepository,
        shoppingListRepository: shoppingListRepository,
      );

      await tester.tap(
        find.byKey(WeeklyPlanScreen.generateShoppingListButtonKey),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(ListGeneratedPromptScreen.generateButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(ListPreviewScreen.errorKey), findsOneWidget);
      expect(find.text('Could not build a list.'), findsOneWidget);
      // Never silently blank: the preview screen is still the current
      // route, no navigation happened past the error.
      expect(find.byType(ListPreviewScreen), findsOneWidget);
    });

    testWidgets(
      're-entering the flow for an already-generated week (ConflictError) routes to the persistent Shopping List, not a transient "could not build a NEW list" error',
      (WidgetTester tester) async {
        final FakeMenuRepository menuRepository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
        );
        final FakeShoppingListRepository shoppingListRepository =
            FakeShoppingListRepository(
              generateError: const ConflictError(
                'A shopping list already exists for this week.',
              ),
            );

        await _pumpWeeklyPlan(
          tester,
          menuRepository: menuRepository,
          shoppingListRepository: shoppingListRepository,
        );

        await tester.tap(
          find.byKey(WeeklyPlanScreen.generateShoppingListButtonKey),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(ListGeneratedPromptScreen.generateButtonKey),
        );
        await tester.pumpAndSettle();

        // Never the "could not build a NEW list" framing — routed straight
        // through to the persistent view instead. That screen's own error
        // state is a KNOWN, documented limitation this week (see its own
        // doc comment) — not asserted as recovered here.
        expect(find.byKey(ListPreviewScreen.errorKey), findsNothing);
        expect(find.byType(ShoppingListScreen), findsOneWidget);
      },
    );

    testWidgets(
      'the notification prompt fires exactly once at the end of the flow, and both its choices land on the persistent Shopping List screen',
      (WidgetTester tester) async {
        final FakeMenuRepository menuRepository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
        );
        final FakeShoppingListRepository shoppingListRepository =
            FakeShoppingListRepository(generateResult: testShoppingList);

        await _pumpWeeklyPlan(
          tester,
          menuRepository: menuRepository,
          shoppingListRepository: shoppingListRepository,
        );

        await tester.tap(
          find.byKey(WeeklyPlanScreen.generateShoppingListButtonKey),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(ListGeneratedPromptScreen.generateButtonKey),
        );
        await tester.pumpAndSettle();

        expect(find.byType(NotificationPermissionPromptScreen), findsNothing);

        await tester.tap(find.byKey(ListPreviewScreen.doneButtonKey));
        await tester.pumpAndSettle();

        // Exactly once: the prompt appears now, having never appeared
        // earlier in this same flow.
        expect(find.byType(NotificationPermissionPromptScreen), findsOneWidget);

        await tester.tap(
          find.byKey(NotificationPermissionPromptScreen.notNowButtonKey),
        );
        await tester.pumpAndSettle();

        expect(find.byType(ShoppingListScreen), findsOneWidget);
        // The prompt is gone from the stack entirely (`context.go` replaces
        // history) — still exactly once, not lingering underneath.
        expect(find.byType(NotificationPermissionPromptScreen), findsNothing);
      },
    );

    testWidgets(
      'hardware back on the notification prompt finishes the flow the same way "Not now" does, never leaving it silently skipped',
      (WidgetTester tester) async {
        final FakeMenuRepository menuRepository = FakeMenuRepository(
          fetchResult: testMenuWithItems,
        );
        final FakeShoppingListRepository shoppingListRepository =
            FakeShoppingListRepository(generateResult: testShoppingList);

        await _pumpWeeklyPlan(
          tester,
          menuRepository: menuRepository,
          shoppingListRepository: shoppingListRepository,
        );

        await tester.tap(
          find.byKey(WeeklyPlanScreen.generateShoppingListButtonKey),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(ListGeneratedPromptScreen.generateButtonKey),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(ListPreviewScreen.doneButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(NotificationPermissionPromptScreen), findsOneWidget);

        // The Android hardware back gesture — NOT a button tap. This
        // screen's own `PopScope(canPop: false, ...)` must intercept it and
        // route through the SAME `_finishFlow` both buttons use, rather
        // than letting the OS pop it back to `ListPreviewScreen` silently
        // (`code-reviewer` finding, W11 S6 review).
        final bool handled = await tester.binding.handlePopRoute();
        expect(handled, isTrue);
        await tester.pumpAndSettle();

        expect(find.byType(ShoppingListScreen), findsOneWidget);
        expect(find.byType(NotificationPermissionPromptScreen), findsNothing);
      },
    );

    testWidgets(
      'the notification prompt never appears anywhere in the household-creation onboarding flow',
      (WidgetTester tester) async {
        // A signed-in user with NO households lands on /first-run per the
        // router's own redirect, then walks the wizard — the exact path
        // onboarding takes. Never a household-scoped repository call here:
        // this is asserting an ABSENCE across the real route table, not
        // exercising the shopping-list flow at all.
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          null,
          repository: FakeHouseholdRepository(
            myHouseholdsResult: const <Household>[],
          ),
        );
        await tester.pumpAndSettle();

        expect(location(harness.router), AppRoutes.firstRun);

        for (final String onboardingRoute in <String>[
          AppRoutes.createHouseholdName,
          AppRoutes.createHouseholdMeals,
          AppRoutes.createHouseholdStructure,
          AppRoutes.createHouseholdCuisine,
          AppRoutes.createHouseholdCuisineBias,
          AppRoutes.createHouseholdDietary,
          AppRoutes.createHouseholdInvite,
        ]) {
          harness.router.go(onboardingRoute);
          await tester.pumpAndSettle();
          expect(
            find.byType(NotificationPermissionPromptScreen),
            findsNothing,
            reason:
                '$onboardingRoute must never render the shopping-list '
                'notification prompt — it is wired ONLY at the end of the '
                'W11 S6 generate flow (Q14), never onboarding.',
          );
        }
      },
    );
  });
}
