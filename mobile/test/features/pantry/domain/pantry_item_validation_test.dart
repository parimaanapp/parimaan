import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_item_validation.dart';

void main() {
  group('validatePantryItemName', () {
    test('accepts a plain non-empty name', () {
      expect(validatePantryItemName('Toor Dal'), isNull);
    });

    test('rejects an empty or whitespace-only name', () {
      expect(validatePantryItemName(''), isNotNull);
      expect(validatePantryItemName('   '), isNotNull);
    });

    test('accepts a name exactly 120 characters long', () {
      expect(validatePantryItemName('a' * 120), isNull);
    });

    test('rejects a name over 120 characters', () {
      expect(validatePantryItemName('a' * 121), isNotNull);
    });

    test('rejects a name containing a control character', () {
      expect(validatePantryItemName('Bad${String.fromCharCode(9)}Name'), isNotNull);
    });
  });

  group('validatePantryItemQuantity', () {
    test('accepts zero and positive values', () {
      expect(validatePantryItemQuantity(0), isNull);
      expect(validatePantryItemQuantity(2.5), isNull);
    });

    test('rejects a negative quantity', () {
      expect(validatePantryItemQuantity(-1), isNotNull);
    });

    test('rejects NaN', () {
      expect(validatePantryItemQuantity(double.nan), isNotNull);
    });
  });

  group('validatePantryItemUnit', () {
    test('accepts a plain non-empty unit', () {
      expect(validatePantryItemUnit('kg'), isNull);
    });

    test('rejects an empty unit', () {
      expect(validatePantryItemUnit(''), isNotNull);
    });

    test('accepts a unit exactly 20 characters long', () {
      expect(validatePantryItemUnit('a' * 20), isNull);
    });

    test('rejects a unit over 20 characters', () {
      expect(validatePantryItemUnit('a' * 21), isNotNull);
    });
  });

  group('validatePantryItemExpiryDate', () {
    test('accepts null (no expiry set)', () {
      expect(validatePantryItemExpiryDate(null), isNull);
    });

    test('accepts a well-formed AWSDate string', () {
      expect(validatePantryItemExpiryDate('2027-03-01'), isNull);
    });

    test('rejects a malformed date', () {
      expect(validatePantryItemExpiryDate('01-03-2027'), isNotNull);
      expect(validatePantryItemExpiryDate('not-a-date'), isNotNull);
    });
  });

  group('validatePantryItemLowThreshold', () {
    test('accepts null (no threshold set)', () {
      expect(validatePantryItemLowThreshold(null), isNull);
    });

    test('accepts zero and positive values', () {
      expect(validatePantryItemLowThreshold(0), isNull);
      expect(validatePantryItemLowThreshold(1.5), isNull);
    });

    test('rejects a negative threshold', () {
      expect(validatePantryItemLowThreshold(-0.1), isNotNull);
    });
  });
}
