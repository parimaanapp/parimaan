import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/household_name.dart';

void main() {
  group(
    'validateHouseholdName — mirrors api/src/validation/createHousehold.ts',
    () {
      test('accepts an ordinary name', () {
        expect(validateHouseholdName('Kulkarni Kitchen'), isNull);
      });

      test('accepts a name that is only valid after trimming', () {
        expect(validateHouseholdName('   Kulkarni Kitchen   '), isNull);
      });

      test('accepts non-Latin scripts and emoji, as the server does', () {
        expect(validateHouseholdName('कुलकर्णी रसोई'), isNull);
        expect(validateHouseholdName('🏠 Home'), isNull);
      });

      test('rejects an empty name', () {
        expect(validateHouseholdName(''), 'name must not be empty');
      });

      test('rejects a whitespace-only name', () {
        expect(validateHouseholdName('     '), 'name must not be empty');
      });

      test('accepts exactly the maximum length', () {
        expect(validateHouseholdName('a' * maxHouseholdNameLength), isNull);
      });

      test('rejects one character past the maximum length', () {
        expect(
          validateHouseholdName('a' * (maxHouseholdNameLength + 1)),
          'name must be at most $maxHouseholdNameLength characters',
        );
      });

      test('measures length after trimming, as the server does', () {
        expect(
          validateHouseholdName('  ${'a' * maxHouseholdNameLength}  '),
          isNull,
        );
      });

      test('rejects control characters', () {
        for (final String name in <String>[
          'Kulkarni\nKitchen',
          'Kulkarni\tKitchen',
          'Kulkarni\u0000Kitchen',
          'Kulkarni\u001bKitchen',
          'Kulkarni\u007fKitchen',
        ]) {
          expect(
            validateHouseholdName(name),
            'name must not contain control characters',
            reason: 'expected $name to be rejected',
          );
        }
      });

      test('the max length matches the server constant', () {
        // `MAX_NAME_LENGTH` in api/src/validation/createHousehold.ts.
        expect(maxHouseholdNameLength, 60);
      });
    },
  );
}
