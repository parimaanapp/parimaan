import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';
import 'package:mobile/features/pantry/presentation/photo_item_edit_sheet.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

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
    MaterialApp(
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
}
