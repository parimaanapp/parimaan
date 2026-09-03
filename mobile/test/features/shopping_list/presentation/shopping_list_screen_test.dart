import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/presentation/checklist_item.dart';
import 'package:mobile/features/shopping_list/presentation/shopping_list_regenerate_confirm_dialog.dart';
import 'package:mobile/features/shopping_list/presentation/shopping_list_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_shopping_list_repository.dart';
import '../../../support/shopping_list_fixtures.dart';

const String _menuId = 'menu-1';

/// A second item, distinct from [testShoppingListItem], so a test asserting
/// "the visible list updated to the regenerate response" has something
/// concrete to look for that could not just be the stale, pre-regenerate
/// list rendered by coincidence.
final ShoppingListItem _regeneratedItem = ShoppingListItem(
  id: 'item-2',
  name: 'Lentils',
  quantity: 1,
  unit: 'kg',
  category: 'grains',
  sourceRecipeId: 'recipe-2',
  purchased: false,
  purchasedBy: null,
  purchasedAt: null,
  movedToPantry: false,
);

final ShoppingList _regeneratedList = ShoppingList(
  id: 'shopping-list-1',
  householdId: 'household-1',
  generatedFromMenuId: _menuId,
  createdAt: DateTime.utc(2026, 9, 2),
  closedAt: null,
  aiStaplesNote: null,
  items: <ShoppingListItem>[_regeneratedItem],
);

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeShoppingListRepository repository,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      shoppingListRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);

  // A real (minimal) GoRouter — `PTopBar.onBack` calls `context.go`, which
  // throws without a real router ancestor, same reasoning
  // `auto_fill_preview_screen_test.dart`'s own pump helper documents.
  final GoRouter router = GoRouter(
    initialLocation: AppRoutes.shoppingList,
    routes: <RouteBase>[
      GoRoute(
        path: AppRoutes.shoppingList,
        builder: (BuildContext context, GoRouterState state) =>
            const ShoppingListScreen(menuId: _menuId),
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
  group('ShoppingListScreen — regenerate (W11 S6b)', () {
    testWidgets(
      'nothing left to buy: Regenerate calls regenerateShoppingList(confirmed: true) with no dialog',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testEmptyShoppingList,
              regenerateResult: _regeneratedList,
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(ShoppingListScreen.regenerateButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(ShoppingListRegenerateConfirmDialog), findsNothing);
        expect(repository.regenerateCalls, <(String, bool)>[(_menuId, true)]);
        expect(find.byKey(ChecklistItem.rowKey('item-2')), findsOneWidget);
      },
    );

    testWidgets(
      'items still to buy: Regenerate shows a confirm dialog; Cancel calls nothing',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              regenerateResult: _regeneratedList,
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(ShoppingListScreen.regenerateButtonKey));
        await tester.pumpAndSettle();

        expect(
          find.byType(ShoppingListRegenerateConfirmDialog),
          findsOneWidget,
        );
        expect(find.text('Replace 1 item still on your list?'), findsOneWidget);

        await tester.tap(
          find.byKey(ShoppingListRegenerateConfirmDialog.cancelButtonKey),
        );
        await tester.pumpAndSettle();

        expect(repository.regenerateCalls, isEmpty);
        // The original list is still what's rendered — untouched.
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);
      },
    );

    testWidgets(
      'a rapid double tap while nothing to lose never fires the mutation twice',
      (WidgetTester tester) async {
        // An artificial delay keeps `regenerateShoppingList`'s call in
        // flight long enough for a second tap to land while the button is
        // (or should be) still `_isBusy`-disabled — without it, the fake
        // repository resolves synchronously-ish and the race window this
        // test targets would close before the second `tap()` even runs
        // (`flutter-reviewer` finding, W11 S6b review: the button must stay
        // disabled for the WHOLE attempt, not just the network call).
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testEmptyShoppingList,
              regenerateResult: _regeneratedList,
              delay: const Duration(milliseconds: 50),
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        // Nothing to lose (`testEmptyShoppingList`), so there is no confirm
        // dialog in between to worry about — this isolates the guard
        // around the mutation call itself.
        await tester.tap(find.byKey(ShoppingListScreen.regenerateButtonKey));
        await tester.pump();
        await tester.tap(
          find.byKey(ShoppingListScreen.regenerateButtonKey),
          warnIfMissed: false,
        );
        await tester.pumpAndSettle();

        expect(repository.regenerateCalls, <(String, bool)>[(_menuId, true)]);
      },
    );

    testWidgets(
      'confirming Replace calls regenerateShoppingList(confirmed: true) and updates the visible list',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              regenerateResult: _regeneratedList,
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(ShoppingListScreen.regenerateButtonKey));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(ShoppingListRegenerateConfirmDialog.confirmButtonKey),
        );
        await tester.pumpAndSettle();

        expect(repository.regenerateCalls, <(String, bool)>[(_menuId, true)]);
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsNothing);
        expect(find.byKey(ChecklistItem.rowKey('item-2')), findsOneWidget);
      },
    );

    testWidgets(
      'a failed regenerate leaves the previously-visible list intact, never blanked',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              regenerateError: const ValidationError('Could not regenerate.'),
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(ShoppingListScreen.regenerateButtonKey));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(ShoppingListRegenerateConfirmDialog.confirmButtonKey),
        );
        await tester.pumpAndSettle();

        // Still the ORIGINAL list, not blanked to a loading/error state.
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);
        expect(find.byKey(ShoppingListScreen.errorKey), findsNothing);
        expect(find.byKey(ShoppingListScreen.emptyKey), findsNothing);
        // The failure is surfaced, not silently swallowed.
        expect(find.text('Could not regenerate.'), findsOneWidget);
      },
    );

    testWidgets(
      'a ConflictError on load offers Regenerate list, which recovers via recoverFromConflict',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateError: const ConflictError(
                'An open shopping list already exists.',
              ),
              regenerateResult: testShoppingList,
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        expect(find.byKey(ShoppingListScreen.errorKey), findsOneWidget);
        expect(
          find.byKey(ShoppingListScreen.conflictRegenerateButtonKey),
          findsOneWidget,
        );

        await tester.tap(
          find.byKey(ShoppingListScreen.conflictRegenerateButtonKey),
        );
        await tester.pumpAndSettle();

        // The preview call (confirmed: false) found a not-yet-bought item,
        // so the confirm dialog gates the commit.
        expect(
          find.byType(ShoppingListRegenerateConfirmDialog),
          findsOneWidget,
        );
        await tester.tap(
          find.byKey(ShoppingListRegenerateConfirmDialog.confirmButtonKey),
        );
        await tester.pumpAndSettle();

        expect(repository.regenerateCalls, <(String, bool)>[
          (_menuId, false),
          (_menuId, true),
        ]);
        expect(find.byKey(ShoppingListScreen.errorKey), findsNothing);
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);
      },
    );

    testWidgets(
      'a rapid double tap on the conflict-recovery action never fires a second preview call',
      (WidgetTester tester) async {
        // The `ConflictError` recovery path is the higher-risk one: unlike
        // the loaded-state Regenerate action (which reads a KNOWN `toBuy`
        // count with no network call before its own confirm decision),
        // `_onConflictRegeneratePressed` issues a real preview call
        // (`recoverFromConflict(confirmed: false)`) before it even knows
        // whether to show a dialog. An artificial delay keeps that preview
        // call in flight long enough for a second tap to land on the same
        // race window this suite already covers for the simpler path
        // (`code-reviewer` finding, W11 S6b review).
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateError: const ConflictError(
                'An open shopping list already exists.',
              ),
              regenerateResult: testEmptyShoppingList,
              delay: const Duration(milliseconds: 50),
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(ShoppingListScreen.conflictRegenerateButtonKey),
        );
        await tester.pump();
        await tester.tap(
          find.byKey(ShoppingListScreen.conflictRegenerateButtonKey),
          warnIfMissed: false,
        );
        await tester.pumpAndSettle();

        // Exactly one preview call, and (nothing to lose, so no dialog)
        // exactly one commit call — never two of either.
        expect(repository.regenerateCalls, <(String, bool)>[
          (_menuId, false),
          (_menuId, true),
        ]);
      },
    );

    testWidgets(
      'a failed preview inside conflict recovery re-enables the action and never shows a dialog',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateError: const ConflictError(
                'An open shopping list already exists.',
              ),
              regenerateError: const ValidationError('Could not preview.'),
            );
        await _pump(tester, repository: repository);
        await tester.pumpAndSettle();

        await tester.tap(
          find.byKey(ShoppingListScreen.conflictRegenerateButtonKey),
        );
        await tester.pumpAndSettle();

        // The failure is surfaced, never silently swallowed.
        expect(find.text('Could not preview.'), findsOneWidget);
        // No confirm dialog — there was never a successful preview to base
        // one on.
        expect(find.byType(ShoppingListRegenerateConfirmDialog), findsNothing);
        // Still the same error state, with the action re-enabled (not
        // stuck disabled/spinning) so the user can retry.
        expect(find.byKey(ShoppingListScreen.errorKey), findsOneWidget);
        final PButton button = tester.widget<PButton>(
          find.byKey(ShoppingListScreen.conflictRegenerateButtonKey),
        );
        expect(button.isLoading, isFalse);
        expect(button.onPressed, isNotNull);
      },
    );
  });
}
