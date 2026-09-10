import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/curated_pantry_items.dart';
import 'package:mobile/features/pantry/domain/curated_pantry_selection.dart';
import 'package:mobile/features/pantry/domain/pantry_unit.dart';
import 'package:mobile/features/pantry/presentation/curated_items_sheet.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

Future<void> _pumpSheet(
  WidgetTester tester, {
  required String category,
  ValueChanged<List<CuratedPantrySelection>>? onSelectionChanged,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: Scaffold(
        body: CuratedItemsSheet(
          category: category,
          onSelectionChanged: onSelectionChanged,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tick(WidgetTester tester, String name) async {
  final Finder finder = find.byKey(CuratedItemsSheet.itemCheckboxKey(name));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _setQuantity(WidgetTester tester, String name, String value) async {
  final Finder finder = find.byKey(CuratedItemsSheet.quantityFieldKey(name));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.enterText(finder, value);
  await tester.pumpAndSettle();
}

Future<void> _setUnit(WidgetTester tester, String name, String unit) async {
  final Finder finder = find.byKey(CuratedItemsSheet.unitChipKey(name, unit));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  group('CuratedItemsSheet', () {
    testWidgets('lists the category\'s curated items in declared order', (
      WidgetTester tester,
    ) async {
      await _pumpSheet(tester, category: 'dal');

      final List<String> expected = curatedPantryItems['dal']!;
      // Assert against the exact declared list — a future accidental
      // `sort()` on the source data would break this test.
      for (final String name in expected) {
        expect(
          find.byKey(CuratedItemsSheet.itemRowKey(name)),
          findsOneWidget,
          reason: '$name should render as a row',
        );
      }
      // Row order in the widget tree follows list order: the i-th row's
      // vertical position increases monotonically with i.
      final List<double> tops = <double>[
        for (final String name in expected)
          tester.getTopLeft(find.byKey(CuratedItemsSheet.itemRowKey(name))).dy,
      ];
      final List<double> sortedTops = List<double>.from(tops)..sort();
      expect(tops, sortedTops, reason: 'rows must render in curatedPantryItems\' order');
    });

    testWidgets('ticking an item raises the stepper for that item specifically', (
      WidgetTester tester,
    ) async {
      await _pumpSheet(tester, category: 'dal');
      final String first = curatedPantryItems['dal']!.first;
      final String second = curatedPantryItems['dal']![1];

      expect(find.byKey(CuratedItemsSheet.quantityFieldKey(first)), findsNothing);
      expect(find.byKey(CuratedItemsSheet.quantityFieldKey(second)), findsNothing);

      await _tick(tester, first);

      expect(find.byKey(CuratedItemsSheet.quantityFieldKey(first)), findsOneWidget);
      expect(find.byKey(CuratedItemsSheet.quantityFieldKey(second)), findsNothing);
    });

    testWidgets('the stepper offers exactly the ten KNOWN_PANTRY_UNITS and no eleventh', (
      WidgetTester tester,
    ) async {
      await _pumpSheet(tester, category: 'dal');
      final String item = curatedPantryItems['dal']!.first;
      await _tick(tester, item);

      for (final String unit in knownPantryUnits) {
        expect(
          find.byKey(CuratedItemsSheet.unitChipKey(item, unit)),
          findsOneWidget,
          reason: '$unit should be offered',
        );
      }
      // No eleventh choice: exactly knownPantryUnits.length unit chips exist
      // for this item.
      int chipCount = 0;
      for (final String candidate in <String>[...knownPantryUnits, 'made-up-unit']) {
        if (find.byKey(CuratedItemsSheet.unitChipKey(item, candidate)).evaluate().isNotEmpty) {
          chipCount++;
        }
      }
      expect(chipCount, knownPantryUnits.length);
    });

    testWidgets('an item ticked and then unticked contributes nothing', (
      WidgetTester tester,
    ) async {
      final List<List<CuratedPantrySelection>> emissions = <List<CuratedPantrySelection>>[];
      await _pumpSheet(
        tester,
        category: 'dal',
        onSelectionChanged: emissions.add,
      );
      final String item = curatedPantryItems['dal']!.first;

      await _tick(tester, item);
      await _setQuantity(tester, item, '2');
      await _setUnit(tester, item, 'kg');
      expect(emissions.last, <CuratedPantrySelection>[
        CuratedPantrySelection(name: item, quantity: 2, unit: 'kg'),
      ]);

      await _tick(tester, item); // untick
      expect(emissions.last, isEmpty);

      // Confirm button reflects the same contributes-nothing state.
      expect(
        tester.widget<PButton>(find.byKey(CuratedItemsSheet.confirmButtonKey)).onPressed,
        isNull,
      );
    });

    testWidgets('multiple ticked items each retain their own quantity/unit independently', (
      WidgetTester tester,
    ) async {
      final List<List<CuratedPantrySelection>> emissions = <List<CuratedPantrySelection>>[];
      await _pumpSheet(
        tester,
        category: 'dal',
        onSelectionChanged: emissions.add,
      );
      final String first = curatedPantryItems['dal']![0];
      final String second = curatedPantryItems['dal']![1];

      await _tick(tester, first);
      await _setQuantity(tester, first, '3');
      await _setUnit(tester, first, 'kg');

      await _tick(tester, second);
      await _setQuantity(tester, second, '500');
      await _setUnit(tester, second, 'g');

      final Set<CuratedPantrySelection> last = emissions.last.toSet();
      expect(
        last,
        <CuratedPantrySelection>{
          CuratedPantrySelection(name: first, quantity: 3, unit: 'kg'),
          CuratedPantrySelection(name: second, quantity: 500, unit: 'g'),
        },
      );
    });

    testWidgets('a freshly ticked item starts with no pre-filled quantity', (
      WidgetTester tester,
    ) async {
      await _pumpSheet(tester, category: 'dal');
      final String item = curatedPantryItems['dal']!.first;

      await _tick(tester, item);

      final TextField field = tester.widget<TextField>(
        find.descendant(
          of: find.byKey(CuratedItemsSheet.quantityFieldKey(item)),
          matching: find.byType(TextField),
        ),
      );
      expect(field.controller!.text, isEmpty);
    });

    testWidgets('a category with no curated entries has no rows', (WidgetTester tester) async {
      await _pumpSheet(tester, category: 'produce');
      expect(find.byType(Checkbox), findsNothing);
    });
  });

  group('categoryHasCuratedEntries', () {
    test('true for a category with curated data', () {
      expect(categoryHasCuratedEntries('dal'), isTrue);
    });

    test('false for produce/other and any unknown category', () {
      expect(categoryHasCuratedEntries('produce'), isFalse);
      expect(categoryHasCuratedEntries('other'), isFalse);
      expect(categoryHasCuratedEntries('a-free-typed-category'), isFalse);
    });
  });
}
