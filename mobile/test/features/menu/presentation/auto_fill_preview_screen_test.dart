import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/meal_slot_plan.dart';
import 'package:mobile/features/menu/domain/menu.dart';
import 'package:mobile/features/menu/presentation/auto_fill_preview_screen.dart';
import 'package:mobile/features/menu/presentation/regenerate_confirm_dialog.dart';
import 'package:mobile/features/menu/state/current_menu_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_menu_repository.dart';
import '../../../support/menu_fixtures.dart';

// testMenuWithItems/testEmptyMenu (menu_fixtures.dart) both carry
// weekStartDate: DateTime.utc(2026, 9, 7) — this key matches that exactly so
// the fixtures resolve through the SAME CurrentMenuController family member
// this screen reads.
final MenuKey _key = menuKeyFor('household-1', DateTime.utc(2026, 9, 7));

/// Every [ProposedMenuItem] a FULL auto-fill would propose for
/// [testMenuHousehold]'s own settings against a completely empty week — the
/// exact set `plannedSlotsForDay` (the same function `WeeklyPlanScreen`'s
/// own grid calls) would enumerate as empty, one proposal per slot. Used by
/// the "cross-language canary" test (E2E_MVP_PLAN.md §16.5.1) to assert this
/// screen renders exactly that many proposed rows — no more, no fewer.
List<ProposedMenuItem> _fullWeekProposals(HouseholdSettings settings) {
  final List<ProposedMenuItem> items = <ProposedMenuItem>[];
  for (int day = 0; day < 7; day++) {
    for (final PlannedSlot slot in plannedSlotsForDay(
      settings,
      const <MenuItem>[],
    )) {
      items.add(
        ProposedMenuItem(
          recipeId: testMenuRecipe.id,
          recipe: testMenuRecipe,
          dayOfWeek: day,
          mealSlot: slot.mealType.wireValue,
          slotRole: slot.slotRole,
        ),
      );
    }
  }
  return items;
}

int _proposedRowCount(WidgetTester tester) => tester
    .widgetList(
      find.byWidgetPredicate(
        (Widget w) =>
            w.key is ValueKey<String> &&
            (w.key! as ValueKey<String>).value.startsWith(
              AutoFillPreviewScreen.proposedKeyPrefix,
            ),
      ),
    )
    .length;

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeMenuRepository menuRepository,
  Household? household,
}) async {
  final Household resolvedHousehold = household ?? testMenuHousehold;
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(fetchResult: resolvedHousehold),
      ),
      menuRepositoryProvider.overrideWithValue(menuRepository),
    ],
  );
  addTearDown(container.dispose);

  // A real (minimal) GoRouter — this screen's own `PTopBar` back affordance
  // and its `_CommittedSummary`'s "Done" button both call `context.pop()`,
  // which throws without a real router ancestor (same reasoning
  // `weekly_plan_screen_test.dart`'s own pump helper documents).
  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.autoFillPreview,
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.autoFillPreview,
        builder: (BuildContext context, GoRouterState state) =>
            AutoFillPreviewScreen(menuKey: _key),
      ),
      GoRoute(
        path: AppRoutes.weeklyPlan,
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('weekly-plan')),
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
  group('AutoFillPreviewScreen — never writes on open/regenerate', () {
    testWidgets('opening the screen calls autoFillPreview exactly once and NEVER autoFillWeek', (
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

      expect(repository.previewCalls, hasLength(1));
      expect(repository.autoFillCalls, isEmpty);
    });

    testWidgets('tapping Regenerate re-calls autoFillPreview and STILL never autoFillWeek', (
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

      await tester.tap(find.byKey(AutoFillPreviewScreen.regenerateButtonKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(AutoFillPreviewScreen.regenerateButtonKey));
      await tester.pumpAndSettle();

      expect(repository.previewCalls, hasLength(3));
      expect(repository.autoFillCalls, isEmpty);
    });

    testWidgets('shows a loading indicator before the first preview resolves', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
        delay: const Duration(milliseconds: 50),
      );
      await _pump(tester, menuRepository: repository);

      expect(find.byKey(AutoFillPreviewScreen.loadingKey), findsOneWidget);
      await tester.pumpAndSettle();
    });
  });

  group('AutoFillPreviewScreen — load/preview failures', () {
    testWidgets('a menu load failure renders the error state, not a blank screen', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchError: const ForbiddenError('Not a member.'),
        createError: const ForbiddenError('Not a member.'),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(AutoFillPreviewScreen.errorKey), findsOneWidget);
      expect(find.text('Not a member.'), findsOneWidget);
    });

    testWidgets('a preview failure renders the error state, and Try again regenerates', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewError: const ValidationError('Could not build a proposal.'),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(AutoFillPreviewScreen.errorKey), findsOneWidget);
      expect(find.text('Could not build a proposal.'), findsOneWidget);

      repository.previewError = null;
      repository.previewResult = const AutoFillPreviewResult(
        items: <ProposedMenuItem>[],
        filledCount: 0,
        unfilledSlots: <UnfilledSlot>[],
      );
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.byKey(AutoFillPreviewScreen.errorKey), findsNothing);
      expect(repository.previewCalls, hasLength(2));
    });
  });

  group('AutoFillPreviewScreen — full-fill slot count (§16.5.1 cross-language canary)', () {
    testWidgets('a full preview renders EXACTLY plannedSlotsForDay\'s own total slot count, across all 7 days', (
      WidgetTester tester,
    ) async {
      final List<ProposedMenuItem> fullWeek = _fullWeekProposals(
        testMenuHousehold.settings,
      );
      // testMenuHousehold's settings (menu_fixtures.dart's own doc): 1
      // breakfast + 4 lunch + 4 dinner = 9 slots/day × 7 days = 63 — asserted
      // here as a floor-level sanity check on the fixture itself, not on the
      // widget under test, so a future change to the fixture's own
      // mealStructure fails loudly here rather than silently changing what
      // the widget assertion below means.
      expect(fullWeek, hasLength(63));

      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: AutoFillPreviewResult(
          items: fullWeek,
          filledCount: fullWeek.length,
          unfilledSlots: const <UnfilledSlot>[],
        ),
      );
      // `_PreviewList` is a lazy `ListView.builder`, same as
      // `WeeklyPlanScreen`'s own grid — without a tall-enough viewport, only
      // the first day's rows are actually built (weekly_plan_screen_test.dart's
      // own comment on this exact laziness). This IS the cross-language
      // canary, so every one of the 63 rows must actually be built and
      // counted, not just Monday's — hence the oversized surface.
      tester.view.physicalSize = const Size(800, 20000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(_proposedRowCount(tester), fullWeek.length);
      expect(find.text('Filled all 63 empty slots.'), findsOneWidget);
    });
  });

  group('AutoFillPreviewScreen — honest partial-fill messaging', () {
    testWidgets('a partial preview renders specific unfilled copy, distinguishable from a full fill', (
      WidgetTester tester,
    ) async {
      final List<ProposedMenuItem> fullWeek = _fullWeekProposals(
        testMenuHousehold.settings,
      );
      final List<ProposedMenuItem> filled = fullWeek.take(40).toList();
      final List<UnfilledSlot> unfilled = fullWeek
          .skip(40)
          .map(
            (ProposedMenuItem p) => UnfilledSlot(
              dayOfWeek: p.dayOfWeek,
              mealSlot: p.mealSlot,
              slotRole: p.slotRole,
            ),
          )
          .toList();

      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: AutoFillPreviewResult(
          items: filled,
          filledCount: filled.length,
          unfilledSlots: unfilled,
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      expect(find.text('Filled 40 of 63 empty slots.'), findsOneWidget);
      expect(
        find.textContaining('23 slots could not be filled'),
        findsOneWidget,
      );
      expect(find.text('Filled all 63 empty slots.'), findsNothing);
    });
  });

  group('AutoFillPreviewScreen — Accept / confirm gate', () {
    testWidgets('Accept with NO existing unmade items commits straight away — no confirm dialog', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
        autoFillResult: AutoFillResult(
          menu: testEmptyMenu,
          filledCount: 0,
          unfilledSlots: const <UnfilledSlot>[],
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(AutoFillPreviewScreen.acceptButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(RegenerateConfirmDialog), findsNothing);
      expect(repository.autoFillCalls, hasLength(1));
      expect(repository.autoFillCalls.single.$2, isTrue); // overwrite: true
    });

    testWidgets('Accept with an existing UNMADE item shows the confirm dialog first', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems, // testMenuItem has madeAt: null
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
        autoFillResult: AutoFillResult(
          menu: testMenuWithItems,
          filledCount: 0,
          unfilledSlots: const <UnfilledSlot>[],
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(AutoFillPreviewScreen.acceptButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(RegenerateConfirmDialog), findsOneWidget);
      expect(repository.autoFillCalls, isEmpty);
    });

    testWidgets('Cancelling the confirm dialog calls autoFillWeek ZERO times', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
        autoFillResult: AutoFillResult(
          menu: testMenuWithItems,
          filledCount: 0,
          unfilledSlots: const <UnfilledSlot>[],
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(AutoFillPreviewScreen.acceptButtonKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(RegenerateConfirmDialog.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(RegenerateConfirmDialog), findsNothing);
      expect(repository.autoFillCalls, isEmpty);
      // Still on the preview — never blanked, never silently navigated away.
      expect(find.byKey(AutoFillPreviewScreen.acceptButtonKey), findsOneWidget);
    });

    testWidgets('affirmatively confirming commits with overwrite: true', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testMenuWithItems,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
        autoFillResult: AutoFillResult(
          menu: testMenuWithItems,
          filledCount: 0,
          unfilledSlots: const <UnfilledSlot>[],
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(AutoFillPreviewScreen.acceptButtonKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(RegenerateConfirmDialog.confirmButtonKey));
      await tester.pumpAndSettle();

      expect(repository.autoFillCalls, hasLength(1));
      expect(repository.autoFillCalls.single.$2, isTrue);
      expect(
        find.byKey(AutoFillPreviewScreen.committedSummaryKey),
        findsOneWidget,
      );
    });

    testWidgets('a menu with only MADE items (madeAt set) skips the confirm dialog', (
      WidgetTester tester,
    ) async {
      final Menu menuWithMadeItemOnly = Menu(
        id: 'menu-1',
        householdId: 'household-1',
        weekStartDate: DateTime.utc(2026, 9, 7),
        items: <MenuItem>[
          MenuItem(
            id: 'menu-item-made',
            menuId: 'menu-1',
            recipe: testMenuRecipe,
            dayOfWeek: 0,
            mealSlot: 'lunch',
            slotRole: testMenuRecipe.role,
            madeAt: DateTime.utc(2026, 9, 8),
          ),
        ],
      );
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: menuWithMadeItemOnly,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
        autoFillResult: AutoFillResult(
          menu: menuWithMadeItemOnly,
          filledCount: 0,
          unfilledSlots: const <UnfilledSlot>[],
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(AutoFillPreviewScreen.acceptButtonKey));
      await tester.pumpAndSettle();

      expect(find.byType(RegenerateConfirmDialog), findsNothing);
      expect(repository.autoFillCalls, hasLength(1));
    });
  });

  group('AutoFillPreviewScreen — commit under-delivering relative to its own preview', () {
    testWidgets('the post-commit summary reflects the COMMIT\'s own numbers, not the earlier preview\'s promise', (
      WidgetTester tester,
    ) async {
      final List<ProposedMenuItem> promised = _fullWeekProposals(
        testMenuHousehold.settings,
      ).take(10).toList();
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: AutoFillPreviewResult(
          items: promised,
          filledCount: promised.length, // preview promised 10
          unfilledSlots: const <UnfilledSlot>[],
        ),
        // The commit's own live re-validation only lands 7 of the 10 —
        // §16.2.1's re-validation-skip case.
        autoFillResult: AutoFillResult(
          menu: testEmptyMenu,
          filledCount: 7,
          unfilledSlots: promised
              .skip(7)
              .map(
                (ProposedMenuItem p) => UnfilledSlot(
                  dayOfWeek: p.dayOfWeek,
                  mealSlot: p.mealSlot,
                  slotRole: p.slotRole,
                ),
              )
              .toList(),
        ),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(AutoFillPreviewScreen.acceptButtonKey));
      await tester.pumpAndSettle();

      // The committed screen shows 7-of-10, not 10-of-10 — the preview's own
      // promise is never reused for the post-commit summary.
      expect(find.text('Filled 7 of 10 empty slots.'), findsOneWidget);
      expect(find.text('Filled all 10 empty slots.'), findsNothing);
    });
  });

  group('AutoFillPreviewScreen — a failed commit leaves the screen intact', () {
    testWidgets('a commit failure shows the error and keeps the preview on screen — never blanked', (
      WidgetTester tester,
    ) async {
      final FakeMenuRepository repository = FakeMenuRepository(
        fetchResult: testEmptyMenu,
        previewResult: const AutoFillPreviewResult(
          items: <ProposedMenuItem>[],
          filledCount: 0,
          unfilledSlots: <UnfilledSlot>[],
        ),
        autoFillError: const ConflictError('This meal slot is full.'),
      );
      await _pump(tester, menuRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(AutoFillPreviewScreen.acceptButtonKey));
      await tester.pumpAndSettle();

      expect(find.byKey(AutoFillPreviewScreen.commitErrorKey), findsOneWidget);
      expect(find.text('This meal slot is full.'), findsOneWidget);
      // Never blanked: the preview's own summary/regenerate/accept controls
      // are all still on screen, and the committed view never appears.
      expect(find.byKey(AutoFillPreviewScreen.summaryKey), findsOneWidget);
      expect(
        find.byKey(AutoFillPreviewScreen.regenerateButtonKey),
        findsOneWidget,
      );
      expect(
        find.byKey(AutoFillPreviewScreen.committedSummaryKey),
        findsNothing,
      );
    });
  });
}
