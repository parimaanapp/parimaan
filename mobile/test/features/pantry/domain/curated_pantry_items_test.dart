import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/curated_pantry_items.dart';
import 'package:mobile/features/pantry/domain/pantry_category.dart';

void main() {
  group('curatedPantryItems', () {
    test('every key is one of the known pantry categories', () {
      for (final String category in curatedPantryItems.keys) {
        expect(
          knownPantryCategories,
          contains(category),
          reason: '"$category" is not in knownPantryCategories',
        );
      }
    });

    test('every present category has at least one entry', () {
      for (final MapEntry<String, List<String>> entry
          in curatedPantryItems.entries) {
        expect(
          entry.value,
          isNotEmpty,
          reason:
              '"${entry.key}" is present but empty — property 1 allows a '
              'category to be ABSENT from the map, not present-and-empty',
        );
      }
    });

    test('no category has a duplicate entry', () {
      for (final MapEntry<String, List<String>> entry
          in curatedPantryItems.entries) {
        expect(
          entry.value.toSet().length,
          entry.value.length,
          reason: '"${entry.key}" has a duplicate item name',
        );
      }
    });

    test('no entry carries a quantity or unit (D5\'s third property)', () {
      // A structural proxy, not a full parse: a curated name should never
      // start with a digit — that is what a pre-filled quantity would look
      // like ("2 Toor Dal"), and this file's whole contract is names only.
      final RegExp leadingDigit = RegExp(r'^\s*\d');
      for (final MapEntry<String, List<String>> entry
          in curatedPantryItems.entries) {
        for (final String item in entry.value) {
          expect(
            leadingDigit.hasMatch(item),
            isFalse,
            reason: '"$item" in "${entry.key}" looks like it carries a '
                'quantity — curated entries are names only',
          );
        }
      }
    });

    test('no entry is blank or only whitespace', () {
      for (final MapEntry<String, List<String>> entry
          in curatedPantryItems.entries) {
        for (final String item in entry.value) {
          expect(item.trim(), isNotEmpty);
          expect(item, item.trim(), reason: '"$item" has leading/trailing whitespace');
        }
      }
    });

    test('dal is present and starts with Toor Dal — the worked example the '
        'founder gave when this slice was scoped', () {
      expect(curatedPantryItems['dal']?.first, 'Toor Dal');
    });

    test('produce and other are deliberately absent, not present-and-empty',
        () {
      expect(curatedPantryItems.containsKey('produce'), isFalse);
      expect(curatedPantryItems.containsKey('other'), isFalse);
    });
  });
}
