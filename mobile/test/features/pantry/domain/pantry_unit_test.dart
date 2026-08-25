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
      ]);
    });
  });
}
