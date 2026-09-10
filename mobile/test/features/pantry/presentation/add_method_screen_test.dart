import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/curated_pantry_selection.dart';
import 'package:mobile/features/pantry/presentation/add_method_screen.dart';
import 'package:mobile/features/pantry/presentation/curated_items_sheet.dart';
import 'package:mobile/shared/ui/theme.dart';

Future<void> _pump(
  WidgetTester tester, {
  required VoidCallback onManual,
  ValueChanged<List<CuratedPantrySelection>>? onCuratedItemsSelected,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: AddMethodScreen(
        onManual: onManual,
        onCuratedItemsSelected: onCuratedItemsSelected,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('AddMethodScreen', () {
    testWidgets('the free-text "Add manually" path is present and reachable', (
      WidgetTester tester,
    ) async {
      int manualTaps = 0;
      await _pump(tester, onManual: () => manualTaps++);

      expect(find.byKey(AddMethodScreen.manualButtonKey), findsOneWidget);
      await tester.tap(find.byKey(AddMethodScreen.manualButtonKey));
      await tester.pumpAndSettle();

      expect(manualTaps, 1);
    });

    testWidgets('"Choose from a list" is a co-equal third card, not a replacement', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onManual: () {});

      expect(find.byKey(AddMethodScreen.curatedButtonKey), findsOneWidget);
      expect(find.byKey(AddMethodScreen.manualButtonKey), findsOneWidget);
      expect(find.byKey(AddMethodScreen.photoButtonKey), findsOneWidget);
    });

    testWidgets('the photo option is disabled', (WidgetTester tester) async {
      await _pump(tester, onManual: () {});

      final Semantics semantics = tester.widget<Semantics>(
        find.byKey(AddMethodScreen.photoButtonKey),
      );
      expect(semantics.properties.enabled, isFalse);
    });

    testWidgets('the photo option announces "coming soon" to screen readers', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onManual: () {});

      final Semantics semantics = tester.widget<Semantics>(
        find.byKey(AddMethodScreen.photoButtonKey),
      );
      expect(semantics.properties.label, contains('Coming soon'));
    });

    testWidgets('picking a category with curated entries opens the multi-select sheet', (
      WidgetTester tester,
    ) async {
      await _pump(tester, onManual: () {});

      await tester.tap(find.byKey(AddMethodScreen.curatedButtonKey));
      await tester.pumpAndSettle();
      expect(find.byKey(CuratedItemsSheet.categoryPickerKey), findsOneWidget);

      await tester.tap(find.byKey(CuratedItemsSheet.categoryChipKey('dal')));
      await tester.pumpAndSettle();

      expect(find.byKey(CuratedItemsSheet.sheetKey), findsOneWidget);
    });

    testWidgets(
      'picking a category with no curated entries falls through to free text, '
      'no empty-state dead end',
      (WidgetTester tester) async {
        int manualTaps = 0;
        await _pump(tester, onManual: () => manualTaps++);

        await tester.tap(find.byKey(AddMethodScreen.curatedButtonKey));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(CuratedItemsSheet.categoryChipKey('produce')));
        await tester.pumpAndSettle();

        expect(find.byKey(CuratedItemsSheet.sheetKey), findsNothing);
        expect(manualTaps, 1);
      },
    );

    testWidgets('confirming the curated sheet hands the selections to the caller', (
      WidgetTester tester,
    ) async {
      List<CuratedPantrySelection>? received;
      await _pump(
        tester,
        onManual: () {},
        onCuratedItemsSelected: (List<CuratedPantrySelection> selections) =>
            received = selections,
      );

      await tester.tap(find.byKey(AddMethodScreen.curatedButtonKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(CuratedItemsSheet.categoryChipKey('dal')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(CuratedItemsSheet.itemCheckboxKey('Toor Dal')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(CuratedItemsSheet.quantityFieldKey('Toor Dal')),
        '1',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(CuratedItemsSheet.unitChipKey('Toor Dal', 'kg')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(CuratedItemsSheet.confirmButtonKey));
      await tester.pumpAndSettle();

      expect(received, <CuratedPantrySelection>[
        const CuratedPantrySelection(name: 'Toor Dal', quantity: 1, unit: 'kg'),
      ]);
    });
  });
}
