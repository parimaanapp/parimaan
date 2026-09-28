import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';

PantryPhotoProposal _proposal({
  String name = 'Toor Dal',
  ProposalConfidence confidence = ProposalConfidence.high,
}) => PantryPhotoProposal(
  name: name,
  quantity: 1,
  unit: 'jar',
  category: 'dal',
  confidence: confidence,
  warnings: const <String>[],
);

void main() {
  group('PantryPhotoProposal', () {
    test(
      'has value equality — two proposals with the same fields are equal',
      () {
        expect(_proposal(), _proposal());
        expect(_proposal().hashCode, _proposal().hashCode);
        expect(_proposal(), isNot(_proposal(name: 'Masoor Dal')));
      },
    );

    test(
      'copyWith changes only what it is given, never mutating the original',
      () {
        final PantryPhotoProposal original = _proposal();
        final PantryPhotoProposal edited = original.copyWith(
          name: 'Toor Dal (split)',
          quantity: 3,
        );

        expect(edited.name, 'Toor Dal (split)');
        expect(edited.quantity, 3);
        expect(edited.unit, 'jar');
        expect(original.name, 'Toor Dal');
      },
    );

    test('copyWith can clear a nullable field, which a plain ?? default could not express', () {
      final PantryPhotoProposal cleared = _proposal().copyWith(
        clearUnit: true,
        clearQuantity: true,
      );
      expect(cleared.unit, isNull);
      expect(cleared.quantity, isNull);
    });

    test('its warnings list cannot be mutated from outside', () {
      final List<String> source = <String>['a'];
      final PantryPhotoProposal p = PantryPhotoProposal(
        name: 'x',
        quantity: null,
        unit: null,
        category: 'other',
        confidence: ProposalConfidence.low,
        warnings: source,
      );
      source.add('b');

      expect(p.warnings, <String>['a']);
      expect(() => p.warnings.add('c'), throwsUnsupportedError);
    });
  });

  group('PantryPhotoAnalysis', () {
    test('an empty analysis reports isEmpty — a normal answer meaning "nothing identifiable", not an error', () {
      final PantryPhotoAnalysis analysis = PantryPhotoAnalysis(
        items: <PantryPhotoProposal>[],
        droppedCount: 0,
        truncated: false,
      );
      expect(analysis.isEmpty, isTrue);
    });

    test('its items list cannot be mutated from outside', () {
      final PantryPhotoAnalysis analysis = PantryPhotoAnalysis(
        items: <PantryPhotoProposal>[_proposal()],
        droppedCount: 0,
        truncated: false,
      );
      expect(() => analysis.items.add(_proposal()), throwsUnsupportedError);
      expect(analysis.isEmpty, isFalse);
    });
  });
}
