import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/catalog/data/catalog_repository.dart';
import 'package:mobile/features/catalog/presentation/ingredient_picker_field.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';
import 'package:mobile/features/pantry/presentation/photo_item_edit_sheet.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_catalog_repository.dart';

PantryPhotoProposal _p({double? quantity = 1, String? unit = 'jar'}) =>
    PantryPhotoProposal(
      name: 'Toor Dal',
      quantity: quantity,
      unit: unit,
      category: 'dal',
      confidence: ProposalConfidence.medium,
      warnings: const <String>[],
    );

Future<PhotoItemEditResult?> _open(
  WidgetTester tester,
  PantryPhotoProposal proposal,
  Future<void> Function() act,
) async {
  PhotoItemEditResult? result;
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        catalogRepositoryProvider.overrideWithValue(FakeCatalogRepository()),
      ],
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: TextButton(
              onPressed: () async =>
                  result = await showPhotoItemEditSheet(context, proposal),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  await act();
  await tester.pumpAndSettle();
  return result;
}

Finder _field(Key key) =>
    find.descendant(of: find.byKey(key), matching: find.byType(TextField));

void main() {
  testWidgets('Done and Remove stay on screen at 320x568 with the keyboard up', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 270);
    addTearDown(tester.view.reset);

    await _open(tester, _p(), () async {
      final Rect done = tester.getRect(find.byKey(PhotoItemEditSheet.doneKey));
      final Rect remove = tester.getRect(
        find.byKey(PhotoItemEditSheet.removeKey),
      );
      const double visibleBottom = 568 - 270;
      expect(done.bottom, lessThanOrEqualTo(visibleBottom));
      expect(remove.bottom, lessThanOrEqualTo(visibleBottom));
      expect(done.top, greaterThanOrEqualTo(0));
    });
  });

  testWidgets(
    'starts from the proposal: name, amount, unit and category are pre-filled',
    (WidgetTester tester) async {
      await _open(tester, _p(quantity: 2), () async {
        expect(
          tester
              .widget<TextField>(_field(PhotoItemEditSheet.nameFieldKey))
              .controller!
              .text,
          'Toor Dal',
        );
        expect(
          tester
              .widget<TextField>(_field(PhotoItemEditSheet.quantityFieldKey))
              .controller!
              .text,
          '2',
        );
        expect(
          tester
              .widget<PChip>(find.byKey(PhotoItemEditSheet.unitChipKey('jar')))
              .selected,
          isTrue,
        );
        expect(
          tester
              .widget<PChip>(
                find.byKey(PhotoItemEditSheet.categoryChipKey('dal')),
              )
              .selected,
          isTrue,
        );
      });
    },
  );

  testWidgets('offers only photo-supportable units', (
    WidgetTester tester,
  ) async {
    await _open(tester, _p(), () async {
      for (final String unit in photoProposalUnits) {
        expect(
          find.byKey(PhotoItemEditSheet.unitChipKey(unit)),
          findsOneWidget,
        );
      }
      expect(find.byKey(PhotoItemEditSheet.unitChipKey('tsp')), findsNothing);
    });
  });

  testWidgets('Done is unavailable while the name is empty', (
    WidgetTester tester,
  ) async {
    await _open(tester, _p(), () async {
      await tester.enterText(_field(PhotoItemEditSheet.nameFieldKey), '   ');
      await tester.pump();
      expect(
        tester
            .widget<PButton>(find.byKey(PhotoItemEditSheet.doneKey))
            .onPressed,
        isNull,
      );
    });
  });

  testWidgets(
    'a cleared or non-positive amount comes back as null, so the row asks for one',
    (WidgetTester tester) async {
      final PhotoItemEditResult? result = await _open(tester, _p(), () async {
        await tester.enterText(
          _field(PhotoItemEditSheet.quantityFieldKey),
          '0',
        );
        await tester.tap(find.byKey(PhotoItemEditSheet.doneKey));
      });

      expect((result! as PhotoItemEdited).proposal.quantity, isNull);
    },
  );

  testWidgets('an over-long name is cut to the server limit', (
    WidgetTester tester,
  ) async {
    final PhotoItemEditResult? result = await _open(tester, _p(), () async {
      await tester.enterText(
        _field(PhotoItemEditSheet.nameFieldKey),
        'x' * 200,
      );
      await tester.tap(find.byKey(PhotoItemEditSheet.doneKey));
    });

    expect(
      (result! as PhotoItemEdited).proposal.name.length,
      photoItemMaxNameLength,
    );
  });

  testWidgets('dismissing without a decision returns null', (
    WidgetTester tester,
  ) async {
    final PhotoItemEditResult? result = await _open(tester, _p(), () async {
      await tester.tapAt(const Offset(10, 10));
    });

    expect(result, isNull);
  });

  testWidgets('picking a catalog match limits units to those a photo can show '
      'and takes its category', (WidgetTester tester) async {
    await _open(tester, _p(unit: 'piece'), () async {
      await tester.enterText(
        find.descendant(
          of: find.byKey(PhotoItemEditSheet.nameFieldKey),
          matching: find.byType(TextField),
        ),
        'tamatar',
      );
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(IngredientPickerField.resultKey(fixtureTomato.id)),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(PhotoItemEditSheet.unitChipKey('piece')),
        findsOneWidget,
      );
      expect(find.byKey(PhotoItemEditSheet.unitChipKey('g')), findsOneWidget);
      expect(find.byKey(PhotoItemEditSheet.unitChipKey('jar')), findsNothing);
      expect(
        tester
            .widget<PChip>(
              find.byKey(PhotoItemEditSheet.categoryChipKey('produce')),
            )
            .selected,
        isTrue,
      );
    });
  });
}
