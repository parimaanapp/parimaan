import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/shopping_list/data/shopping_list_repository.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/presentation/checklist_item.dart';
import 'package:mobile/features/shopping_list/presentation/have_it_quantity_sheet.dart';
import 'package:mobile/features/shopping_list/state/current_shopping_list_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/colors.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_shopping_list_repository.dart';
import '../../../support/shopping_list_fixtures.dart';

const String _menuId = 'menu-1';

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakeShoppingListRepository repository,
  ShoppingListItem? item,
}) async {
  final ShoppingListItem resolvedItem = item ?? testShoppingListItem;
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      shoppingListRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Scaffold(
          body: ChecklistItem(item: resolvedItem, menuId: _menuId),
        ),
      ),
    ),
  );
  return container;
}

/// Triggers [ChecklistItem]'s swipe gesture by invoking the row's own
/// `Dismissible.confirmDismiss` directly, rather than simulating a pixel
/// drag — `Dismissible`'s gesture recognition (touch slop, fling velocity,
/// dismiss-threshold-as-a-fraction-of-width) is exactly the kind of
/// framework-internal timing this suite has no business asserting against;
/// what S7's own RED tests care about is what `confirmDismiss` DOES once
/// invoked, not the pixel math that gets it invoked.
///
/// `pumpAndSettle()`, not a single `pump()`: the modal bottom sheet's own
/// entrance transition needs to finish before any button inside it sits at
/// its final, tappable position — a bare `pump()` leaves the sheet
/// mid-slide-up, off the bottom of the test surface, and a `tap()` against
/// it silently misses (a real bug this suite tripped over: a missed tap on
/// Cancel never resolves the sheet's own Future, which then hangs the test
/// forever). This is safe here specifically because nothing async is
/// in-flight yet at the moment the sheet opens (no `_isBusy` spinner ticking
/// until a confirm is actually pressed) — every caller below settles BEFORE
/// pressing Confirm, never while it's loading.
Future<void> _swipe(WidgetTester tester, String itemId) async {
  final Dismissible dismissible = tester.widget<Dismissible>(
    find.ancestor(
      of: find.byKey(ChecklistItem.rowKey(itemId)),
      matching: find.byType(Dismissible),
    ),
  );
  unawaited(dismissible.confirmDismiss!(DismissDirection.endToStart));
  await tester.pumpAndSettle();
}

void main() {
  group('ChecklistItem — swipe-to-Have-it (W11 S7)', () {
    testWidgets(
      'swiping opens the Have-it quantity sheet, never calls haveIt directly',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(haveItResult: testEmptyShoppingList);
        await _pump(tester, repository: repository);

        await _swipe(tester, 'item-1');

        expect(find.byType(HaveItQuantitySheet), findsOneWidget);
        expect(repository.haveItCalls, isEmpty);
      },
    );

    testWidgets(
      'the pre-filled quantity matches the shopping-list item\'s own quantity exactly (D5)',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(haveItResult: testEmptyShoppingList);
        // testShoppingListItem.quantity == 2.
        await _pump(tester, repository: repository);

        await _swipe(tester, 'item-1');

        final TextField field = tester.widget<TextField>(
          find
              .descendant(
                of: find.byKey(HaveItQuantitySheet.quantityFieldKey),
                matching: find.byType(TextField),
              )
              .first,
        );
        expect(field.controller!.text, '2');
      },
    );

    testWidgets(
      'confirming with the unedited default calls haveIt with the item\'s own quantity',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              haveItResult: testEmptyShoppingList,
            );
        await _pump(tester, repository: repository);

        await _swipe(tester, 'item-1');
        await tester.tap(find.byKey(HaveItQuantitySheet.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(repository.haveItCalls, <(String, double)>[('item-1', 2)]);
      },
    );

    testWidgets(
      'confirming with an edited quantity calls haveIt with the edited value, not the default',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              haveItResult: testEmptyShoppingList,
            );
        await _pump(tester, repository: repository);

        await _swipe(tester, 'item-1');
        await tester.enterText(
          find.descendant(
            of: find.byKey(HaveItQuantitySheet.quantityFieldKey),
            matching: find.byType(TextField),
          ),
          '5',
        );
        await tester.tap(find.byKey(HaveItQuantitySheet.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(repository.haveItCalls, <(String, double)>[('item-1', 5)]);
      },
    );

    testWidgets(
      'cancelling calls nothing — no haveIt invocation, item stays as-is',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(haveItResult: testEmptyShoppingList);
        await _pump(tester, repository: repository);

        await _swipe(tester, 'item-1');
        await tester.tap(find.byKey(HaveItQuantitySheet.cancelButtonKey));
        await tester.pumpAndSettle();

        expect(repository.haveItCalls, isEmpty);
        expect(find.byType(HaveItQuantitySheet), findsNothing);
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);
      },
    );

    testWidgets(
      'a failed haveIt leaves the item visible and unmoved, with a visible error',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              haveItError: const ConflictError('This item was already bought.'),
            );
        await _pump(tester, repository: repository);

        await _swipe(tester, 'item-1');
        await tester.tap(find.byKey(HaveItQuantitySheet.confirmButtonKey));
        await tester.pumpAndSettle();

        // The sheet is still up, not popped — the failure is surfaced, not
        // a silently-reverted swipe.
        expect(find.byType(HaveItQuantitySheet), findsOneWidget);
        expect(find.byKey(HaveItQuantitySheet.errorKey), findsOneWidget);
        expect(find.text('This item was already bought.'), findsOneWidget);
        // The row behind the sheet is untouched.
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);
      },
    );

    testWidgets(
      'a second swipe while a confirm is already pending never opens a second sheet or double-calls haveIt',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(haveItResult: testEmptyShoppingList);
        await _pump(tester, repository: repository);

        final Dismissible dismissible = tester.widget<Dismissible>(
          find.ancestor(
            of: find.byKey(ChecklistItem.rowKey('item-1')),
            matching: find.byType(Dismissible),
          ),
        );

        // The first call opens the sheet; its own Future stays pending
        // until the sheet resolves (below), same as a real swipe.
        final Future<bool?> first = dismissible.confirmDismiss!(
          DismissDirection.endToStart,
        );
        await tester.pumpAndSettle();
        expect(find.byType(HaveItQuantitySheet), findsOneWidget);

        // A second swipe landing while the first is still pending must be
        // rejected immediately — [ChecklistItem]'s own `_isProcessing`
        // guard — never opening a second sheet.
        final bool? second = await dismissible.confirmDismiss!(
          DismissDirection.endToStart,
        );
        expect(second, false);
        expect(find.byType(HaveItQuantitySheet), findsOneWidget);

        await tester.tap(find.byKey(HaveItQuantitySheet.cancelButtonKey));
        await tester.pumpAndSettle();

        expect(await first, false);
        expect(repository.haveItCalls, isEmpty);
      },
    );
  });

  group('ChecklistItem — no menuId (List preview usage)', () {
    testWidgets('renders a plain row with no swipe affordance', (
      WidgetTester tester,
    ) async {
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          shoppingListRepositoryProvider.overrideWithValue(
            FakeShoppingListRepository(),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: parimaanTheme(),
            home: Scaffold(body: ChecklistItem(item: testShoppingListItem)),
          ),
        ),
      );

      expect(find.byType(Dismissible), findsNothing);
      expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);
    });

    testWidgets(
      'the "bought" checkbox is ABSENT (not merely disabled) — matches the swipe gesture\'s own menuId gate (D6, W12 S6)',
      (WidgetTester tester) async {
        final ProviderContainer container = ProviderContainer(
          overrides: <Override>[
            shoppingListRepositoryProvider.overrideWithValue(
              FakeShoppingListRepository(),
            ),
          ],
        );
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: parimaanTheme(),
              home: Scaffold(body: ChecklistItem(item: testShoppingListItem)),
            ),
          ),
        );

        expect(find.byKey(ChecklistItem.checkboxKey('item-1')), findsNothing);
      },
    );
  });

  group('ChecklistItem — "bought" checkbox (D6, W12 S6)', () {
    testWidgets(
      'tapping the checkbox calls markPurchased with the correct itemId, never haveIt',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              markPurchasedResult: testEmptyShoppingList,
            );
        await _pump(tester, repository: repository);

        await tester.tap(find.byKey(ChecklistItem.checkboxKey('item-1')));
        await tester.pumpAndSettle();

        expect(repository.markPurchasedCalls, <String>['item-1']);
        expect(repository.haveItCalls, isEmpty);
      },
    );

    testWidgets(
      'no confirmation sheet is shown for the checkbox path (D5/D6)',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              markPurchasedResult: testEmptyShoppingList,
            );
        await _pump(tester, repository: repository);

        await tester.tap(find.byKey(ChecklistItem.checkboxKey('item-1')));
        await tester.pumpAndSettle();

        expect(find.byType(HaveItQuantitySheet), findsNothing);
      },
    );

    testWidgets(
      'the checkbox and the swipe gesture on the same row never double-fire in quick succession — checkbox first, then swipe',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              markPurchasedResult: testEmptyShoppingList,
              delay: const Duration(milliseconds: 50),
            );
        await _pump(tester, repository: repository);

        // Tap the checkbox but don't let its markPurchased call resolve yet.
        await tester.tap(find.byKey(ChecklistItem.checkboxKey('item-1')));
        await tester.pump();

        // A swipe landing while the checkbox tap is still in flight must be
        // rejected immediately by the SAME `_isProcessing` guard the swipe
        // gesture already uses for itself — never opening the Have-it
        // sheet, never calling haveIt.
        final Dismissible dismissible = tester.widget<Dismissible>(
          find.ancestor(
            of: find.byKey(ChecklistItem.rowKey('item-1')),
            matching: find.byType(Dismissible),
          ),
        );
        final bool? swipeResult = await dismissible.confirmDismiss!(
          DismissDirection.endToStart,
        );
        expect(swipeResult, false);
        expect(find.byType(HaveItQuantitySheet), findsNothing);
        expect(repository.haveItCalls, isEmpty);

        await tester.pumpAndSettle();
        expect(repository.markPurchasedCalls, <String>['item-1']);
      },
    );

    testWidgets(
      'the checkbox and the swipe gesture on the same row never double-fire in quick succession — swipe first, then checkbox',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(haveItResult: testEmptyShoppingList);
        await _pump(tester, repository: repository);

        final Dismissible dismissible = tester.widget<Dismissible>(
          find.ancestor(
            of: find.byKey(ChecklistItem.rowKey('item-1')),
            matching: find.byType(Dismissible),
          ),
        );
        final Future<bool?> swipeFuture = dismissible.confirmDismiss!(
          DismissDirection.endToStart,
        );
        await tester.pumpAndSettle();
        expect(find.byType(HaveItQuantitySheet), findsOneWidget);

        // The checkbox is still on-screen behind the sheet, but the Have-it
        // sheet's own modal barrier sits on top of it, so a `tester.tap`
        // wouldn't reliably land on the checkbox itself — asserting on the
        // widget directly is what actually proves the shared `_isProcessing`
        // guard disabled it (`onChanged: null`) while the swipe attempt is
        // still pending, rather than merely proving a tap missed.
        expect(
          tester
              .widget<ChecklistCheckBox>(
                find.byKey(ChecklistItem.checkboxKey('item-1')),
              )
              .onChanged,
          isNull,
        );
        expect(repository.markPurchasedCalls, isEmpty);

        await tester.tap(
          find.byKey(HaveItQuantitySheet.cancelButtonKey),
          warnIfMissed: false,
        );
        await tester.pumpAndSettle();
        expect(await swipeFuture, false);
        expect(repository.markPurchasedCalls, isEmpty);
      },
    );

    testWidgets(
      'a successful markPurchased removes the row via the controller\'s own state rebuild, not a locally-hidden checkbox',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              markPurchasedResult: testEmptyShoppingList,
            );
        final ProviderContainer container = ProviderContainer(
          overrides: <Override>[
            shoppingListRepositoryProvider.overrideWithValue(repository),
          ],
        );
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: parimaanTheme(),
              home: Scaffold(
                body: Consumer(
                  builder: (BuildContext context, WidgetRef ref, _) {
                    final AsyncValue<ShoppingList> list = ref.watch(
                      currentShoppingListControllerProvider(_menuId),
                    );
                    final List<ShoppingListItem> toBuy =
                        list.valueOrNull?.toBuy ?? const <ShoppingListItem>[];
                    return CategorizedChecklist(items: toBuy, menuId: _menuId);
                  },
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);

        await tester.tap(find.byKey(ChecklistItem.checkboxKey('item-1')));
        await tester.pumpAndSettle();

        expect(repository.markPurchasedCalls, <String>['item-1']);
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsNothing);
      },
    );

    testWidgets(
      'a failed markPurchased reverts the optimistic checked state and shows a visible error',
      (WidgetTester tester) async {
        final FakeShoppingListRepository repository =
            FakeShoppingListRepository(
              generateResult: testShoppingList,
              markPurchasedError: const ConflictError(
                'This item was already bought.',
              ),
              delay: const Duration(milliseconds: 50),
            );
        await _pump(tester, repository: repository);

        await tester.tap(find.byKey(ChecklistItem.checkboxKey('item-1')));
        await tester.pump();
        // Optimistically checked the instant the tap lands, before the
        // failing call has even resolved.
        expect(
          tester
              .widget<ChecklistCheckBox>(
                find.byKey(ChecklistItem.checkboxKey('item-1')),
              )
              .isChecked,
          true,
        );

        await tester.pumpAndSettle();

        // Reverted back to unchecked on failure — never a silent no-op.
        expect(
          tester
              .widget<ChecklistCheckBox>(
                find.byKey(ChecklistItem.checkboxKey('item-1')),
              )
              .isChecked,
          false,
        );
        expect(find.byKey(ChecklistItem.rowKey('item-1')), findsOneWidget);
        expect(find.text('This item was already bought.'), findsOneWidget);
      },
    );
  });

  group('ChecklistItem — swipe right marks bought (C2)', () {
    testWidgets('swiping right calls markPurchased, never opens the sheet', (
      WidgetTester tester,
    ) async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
        markPurchasedResult: testEmptyShoppingList,
      );
      await _pump(tester, repository: repository);

      final Dismissible dismissible = tester.widget<Dismissible>(
        find.ancestor(
          of: find.byKey(ChecklistItem.rowKey('item-1')),
          matching: find.byType(Dismissible),
        ),
      );
      final bool? result = await dismissible.confirmDismiss!(
        DismissDirection.startToEnd,
      );
      await tester.pumpAndSettle();

      expect(result, false);
      expect(repository.markPurchasedCalls, <String>['item-1']);
      expect(repository.haveItCalls, isEmpty);
      expect(find.byType(HaveItQuantitySheet), findsNothing);
    });

    testWidgets('both swipe directions are enabled', (
      WidgetTester tester,
    ) async {
      await _pump(tester, repository: FakeShoppingListRepository());
      final Dismissible dismissible = tester.widget<Dismissible>(
        find.byType(Dismissible),
      );
      expect(dismissible.direction, DismissDirection.horizontal);
    });

    testWidgets('exposes Have it and Mark bought as screen-reader actions', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, repository: FakeShoppingListRepository());

      final SemanticsData data = tester
          .getSemantics(find.byKey(ChecklistItem.rowKey('item-1')))
          .getSemanticsData();
      final Set<String> labels = data.customSemanticsActionIds!
          .map((int id) => CustomSemanticsAction.getAction(id)!.label!)
          .toSet();
      expect(labels, containsAll(<String>['Have it', 'Mark bought']));
      handle.dispose();
    });
  });

  group('ChecklistItem — check-row visuals (C2, wireframe 10.1)', () {
    testWidgets('undone row: 18 px box, radius 6, no fill, mono quantity', (
      WidgetTester tester,
    ) async {
      await _pump(tester, repository: FakeShoppingListRepository());

      final Size box = tester.getSize(
        find.byKey(ChecklistCheckBox.boxKey('item-1')),
      );
      expect(box, const Size(18, 18));
      final BoxDecoration decoration =
          tester
                  .widget<Container>(
                    find.byKey(ChecklistCheckBox.boxKey('item-1')),
                  )
                  .decoration!
              as BoxDecoration;
      expect(decoration.borderRadius, BorderRadius.circular(6));
      expect(decoration.color, isNot(AppColors.cardamom));

      final Text quantity = tester.widget<Text>(find.text('2 kg'));
      expect(quantity.style!.fontFamily, 'JetBrains Mono');
      expect(
        tester.widget<Text>(find.text('Rice')).style!.decoration,
        isNot(TextDecoration.lineThrough),
      );
    });

    testWidgets('done row (purchased): green fill, strike-through name', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        repository: FakeShoppingListRepository(),
        item: testPurchasedShoppingListItem,
      );

      final BoxDecoration decoration =
          tester
                  .widget<Container>(
                    find.byKey(ChecklistCheckBox.boxKey('item-1')),
                  )
                  .decoration!
              as BoxDecoration;
      expect(decoration.color, AppColors.cardamom);
      expect(
        tester.widget<Text>(find.text('Rice')).style!.decoration,
        TextDecoration.lineThrough,
      );
    });

    testWidgets('optimistic tap turns the row done immediately', (
      WidgetTester tester,
    ) async {
      final FakeShoppingListRepository repository = FakeShoppingListRepository(
        generateResult: testShoppingList,
        markPurchasedResult: testEmptyShoppingList,
        delay: const Duration(milliseconds: 50),
      );
      await _pump(tester, repository: repository);

      await tester.tap(find.byKey(ChecklistItem.checkboxKey('item-1')));
      await tester.pump();

      expect(
        tester.widget<Text>(find.text('Rice')).style!.decoration,
        TextDecoration.lineThrough,
      );
      await tester.pumpAndSettle();
    });

    testWidgets('the check target is at least 44 x 44', (
      WidgetTester tester,
    ) async {
      await _pump(tester, repository: FakeShoppingListRepository());
      final Size size = tester.getSize(
        find.byKey(ChecklistItem.checkboxKey('item-1')),
      );
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
    });

    testWidgets('the check announces its item and checked state', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, repository: FakeShoppingListRepository());
      expect(
        tester.getSemantics(find.byKey(ChecklistItem.checkboxKey('item-1'))),
        matchesSemantics(
          label: 'Mark Rice as bought',
          hasCheckedState: true,
          isChecked: false,
          hasEnabledState: true,
          isEnabled: true,
          hasTapAction: true,
          hasFocusAction: true,
          isFocusable: true,
        ),
      );
      handle.dispose();
    });

    testWidgets('long name and quantity do not overflow at 320 pt', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final ShoppingListItem long = ShoppingListItem(
        id: 'item-1',
        name: 'Kashmiri red chilli powder, extra long ingredient name here',
        quantity: 1250.5,
        unit: 'bunch',
        category: 'spice',
        sourceRecipeId: null,
        purchased: false,
        purchasedBy: null,
        purchasedAt: null,
        movedToPantry: false,
      );
      await _pump(tester, repository: FakeShoppingListRepository(), item: long);
      expect(tester.takeException(), isNull);
    });
  });
}
