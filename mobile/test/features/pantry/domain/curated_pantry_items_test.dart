import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/curated_pantry_items.dart';
import 'package:mobile/features/pantry/domain/pantry_category.dart';

/// Splits one CSV line, honouring double-quoted fields (names such as
/// `Moong Dal (Split, Yellow)` contain commas).
List<String> _splitCsvLine(String line) {
  final List<String> fields = <String>[];
  final StringBuffer current = StringBuffer();
  bool quoted = false;
  for (int i = 0; i < line.length; i++) {
    final String ch = line[i];
    if (ch == '"') {
      if (quoted && i + 1 < line.length && line[i + 1] == '"') {
        current.write('"');
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch == ',' && !quoted) {
      fields.add(current.toString());
      current.clear();
    } else {
      current.write(ch);
    }
  }
  fields.add(current.toString());
  return fields;
}

Set<String> _canonicalCatalogNames() {
  // `flutter test` runs with the package (mobile/) as the working directory.
  final File csv = File('../docs/catalog/ingredients.csv');
  final List<String> lines = csv.readAsLinesSync();
  final List<String> header = _splitCsvLine(lines.first);
  final int nameIndex = header.indexOf('canonical_name');
  expect(nameIndex, isNonNegative, reason: 'canonical_name column missing');
  return lines
      .skip(1)
      .where((String l) => l.trim().isNotEmpty)
      .map((String l) => _splitCsvLine(l)[nameIndex])
      .toSet();
}

void main() {
  group('curatedPantryItems', () {
    test(
      'every item is an exact canonical_name from the ingredient catalog',
      () {
        final Set<String> canonical = _canonicalCatalogNames();
        expect(canonical.length, greaterThan(1000));
        for (final MapEntry<String, List<String>> entry
            in curatedPantryItems.entries) {
          for (final String item in entry.value) {
            expect(
              canonical,
              contains(item),
              reason:
                  '"$item" in "${entry.key}" is not a canonical_name in '
                  'docs/catalog/ingredients.csv',
            );
          }
        }
      },
    );

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
            reason:
                '"$item" in "${entry.key}" looks like it carries a '
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
          expect(
            item,
            item.trim(),
            reason: '"$item" has leading/trailing whitespace',
          );
        }
      }
    });

    test('dal is present and starts with Toor Dal — the worked example the '
        'founder gave when this slice was scoped', () {
      expect(curatedPantryItems['dal']?.first, 'Toor Dal');
    });

    test(
      'produce and other are deliberately absent, not present-and-empty',
      () {
        expect(curatedPantryItems.containsKey('produce'), isFalse);
        expect(curatedPantryItems.containsKey('other'), isFalse);
      },
    );
  });
}
