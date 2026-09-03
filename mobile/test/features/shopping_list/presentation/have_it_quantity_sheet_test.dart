import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/shopping_list/domain/shopping_list_item.dart';
import 'package:mobile/features/shopping_list/presentation/have_it_quantity_sheet.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/shopping_list_fixtures.dart';

/// Isolated widget tests for [HaveItQuantitySheet]/[showHaveItQuantitySheet]
/// — [ChecklistItem]'s own swipe-integration tests
/// (`checklist_item_test.dart`) cover the gesture wiring; these cover the
/// sheet's own confirm/cancel/error contract directly, provider-free, via
/// the [onConfirm] callback the sheet is built around.
Future<List<double>> _pumpAndGetConfirmedQuantities(
  WidgetTester tester, {
  required ShoppingListItem item,
  Future<void> Function(double quantity)? onConfirm,
}) async {
  final List<double> confirmed = <double>[];
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => TextButton(
            onPressed: () => showHaveItQuantitySheet(
              context: context,
              item: item,
              onConfirm: (double quantity) async {
                confirmed.add(quantity);
                if (onConfirm != null) await onConfirm(quantity);
              },
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return confirmed;
}

void main() {
  group('HaveItQuantitySheet — D5 default quantity', () {
    testWidgets('pre-fills the field with the item\'s own quantity', (
      WidgetTester tester,
    ) async {
      await _pumpAndGetConfirmedQuantities(tester, item: testShoppingListItem);

      final TextField field = tester.widget<TextField>(
        find
            .descendant(
              of: find.byKey(HaveItQuantitySheet.quantityFieldKey),
              matching: find.byType(TextField),
            )
            .first,
      );
      expect(field.controller!.text, '2');
    });

    testWidgets('drops a trailing .0 for a whole-number quantity', (
      WidgetTester tester,
    ) async {
      expect(HaveItQuantitySheet.formatDefaultQuantity(2), '2');
      expect(HaveItQuantitySheet.formatDefaultQuantity(2.5), '2.5');
      expect(HaveItQuantitySheet.formatDefaultQuantity(null), '');
    });
  });

  group('HaveItQuantitySheet — confirm', () {
    testWidgets(
      'confirming without editing calls onConfirm with the default quantity',
      (WidgetTester tester) async {
        final List<double> confirmed = await _pumpAndGetConfirmedQuantities(
          tester,
          item: testShoppingListItem,
        );

        await tester.tap(find.byKey(HaveItQuantitySheet.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(confirmed, <double>[2]);
      },
    );

    testWidgets(
      'confirming after an edit calls onConfirm with the edited value',
      (WidgetTester tester) async {
        final List<double> confirmed = await _pumpAndGetConfirmedQuantities(
          tester,
          item: testShoppingListItem,
        );

        await tester.enterText(
          find.descendant(
            of: find.byKey(HaveItQuantitySheet.quantityFieldKey),
            matching: find.byType(TextField),
          ),
          '7.5',
        );
        await tester.tap(find.byKey(HaveItQuantitySheet.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(confirmed, <double>[7.5]);
      },
    );

    testWidgets('a zero or blank quantity disables the confirm button', (
      WidgetTester tester,
    ) async {
      await _pumpAndGetConfirmedQuantities(tester, item: testShoppingListItem);

      await tester.enterText(
        find.descendant(
          of: find.byKey(HaveItQuantitySheet.quantityFieldKey),
          matching: find.byType(TextField),
        ),
        '0',
      );
      await tester.pump();

      final PButton confirmButton = tester.widget<PButton>(
        find.byKey(HaveItQuantitySheet.confirmButtonKey),
      );
      expect(confirmButton.onPressed, isNull);
    });
  });

  group('HaveItQuantitySheet — cancel', () {
    testWidgets('cancelling calls onConfirm zero times', (
      WidgetTester tester,
    ) async {
      final List<double> confirmed = await _pumpAndGetConfirmedQuantities(
        tester,
        item: testShoppingListItem,
      );

      await tester.tap(find.byKey(HaveItQuantitySheet.cancelButtonKey));
      await tester.pumpAndSettle();

      expect(confirmed, isEmpty);
      expect(find.byType(HaveItQuantitySheet), findsNothing);
    });
  });

  group('HaveItQuantitySheet — failed confirm', () {
    testWidgets(
      'a failed onConfirm keeps the sheet open and shows the error inline',
      (WidgetTester tester) async {
        await _pumpAndGetConfirmedQuantities(
          tester,
          item: testShoppingListItem,
          onConfirm: (double quantity) async {
            throw const ConflictError('This item was already bought.');
          },
        );

        await tester.tap(find.byKey(HaveItQuantitySheet.confirmButtonKey));
        await tester.pumpAndSettle();

        expect(find.byType(HaveItQuantitySheet), findsOneWidget);
        expect(find.byKey(HaveItQuantitySheet.errorKey), findsOneWidget);
        expect(find.text('This item was already bought.'), findsOneWidget);
      },
    );
  });
}
