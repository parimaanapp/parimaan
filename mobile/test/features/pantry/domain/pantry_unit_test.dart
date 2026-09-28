import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_unit.dart';

void main() {
  group('knownPantryUnits', () {
    test('matches the server-side canonical set exactly', () {
      expect(knownPantryUnits, <String>[
        'g',
        'kg',
        'ml',
        'l',
        'piece',
        'packet',
        'bunch',
        'tsp',
        'tbsp',
        'cup',
        'jar',
        'bottle',
      ]);
    });

    test('knows jar and bottle — W19 S2\'s real Gemini vision spike found >75% of real photo-sourced quantities used container-count units these weren\'t in yet', () {
      expect(knownPantryUnits, contains('jar'));
      expect(knownPantryUnits, contains('bottle'));
    });
  });
}
