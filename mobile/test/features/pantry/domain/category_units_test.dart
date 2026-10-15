import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/category_units.dart';
import 'package:mobile/features/pantry/domain/pantry_category.dart';
import 'package:mobile/features/pantry/domain/pantry_unit.dart';

/// Minimal CSV line split honouring double-quoted fields (names such as
/// "Moong Dal (Split, Green)" contain commas).
List<String> _splitCsvLine(String line) {
  final List<String> cols = <String>[];
  final StringBuffer buf = StringBuffer();
  bool quoted = false;
  for (final int rune in line.runes) {
    final String ch = String.fromCharCode(rune);
    if (ch == '"') {
      quoted = !quoted;
    } else if (ch == ',' && !quoted) {
      cols.add(buf.toString());
      buf.clear();
    } else {
      buf.write(ch);
    }
  }
  cols.add(buf.toString());
  return cols;
}

/// The catalog's `pack` is the app's `packet`.
String _catalogUnit(String unit) => unit == 'pack' ? 'packet' : unit;

void main() {
  group('categoryUnits table', () {
    test('has an entry for every known category and nothing else', () {
      expect(categoryUnits.keys.toSet(), knownPantryCategories.toSet());
    });

    test('lists the default unit first for every category', () {
      categoryUnits.forEach((String category, CategoryUnits units) {
        expect(units.units.first, units.defaultUnit, reason: category);
        expect(units.units.toSet().length, units.units.length, reason: category);
      });
    });

    test('dal and grain offer only g, kg, cup', () {
      for (final String c in <String>['dal', 'grain']) {
        expect(unitsForCategory(c), <String>['g', 'kg', 'cup']);
      }
    });

    test('oil leads with ml and offers ml, l, tbsp, tsp, cup, bottle, packet', () {
      final List<String> units = unitsForCategory('oil');
      expect(units.first, 'ml');
      expect(
        units,
        containsAll(<String>['ml', 'l', 'tbsp', 'tsp', 'cup', 'bottle', 'packet']),
      );
    });

    test('eggs offer piece and dozen only', () {
      expect(unitsForCategory('eggs'), <String>['piece', 'dozen']);
    });

    test('default unit lookups', () {
      expect(defaultUnitForCategory('dal'), 'g');
      expect(defaultUnitForCategory('oil'), 'ml');
      expect(defaultUnitForCategory('eggs'), 'piece');
      expect(defaultUnitForCategory('snacks'), 'packet');
    });

    test('unknown or null category falls back to all known units', () {
      expect(unitsForCategory(null), knownPantryUnits);
      expect(unitsForCategory('festival'), knownPantryUnits);
      expect(defaultUnitForCategory(null), isNull);
    });

    test('unitsWithCurrent keeps an out-of-list existing unit visible', () {
      expect(unitsWithCurrent('dal', 'ml'), <String>['g', 'kg', 'cup', 'ml']);
      expect(unitsWithCurrent('dal', 'kg'), <String>['g', 'kg', 'cup']);
      expect(unitsWithCurrent('dal', ''), <String>['g', 'kg', 'cup']);
      expect(unitsWithCurrent('dal', null), <String>['g', 'kg', 'cup']);
    });

    test('unitsWithCurrent compares case-insensitively and never rewrites casing', () {
      expect(unitsWithCurrent('dal', 'KG'), <String>['g', 'kg', 'cup']);
      expect(unitsWithCurrent('dal', ' Kg '), <String>['g', 'kg', 'cup']);
      expect(unitsWithCurrent('dal', 'ML'), <String>['g', 'kg', 'cup', 'ML']);
    });

    test('every offered unit is a known pantry unit', () {
      for (final MapEntry<String, CategoryUnits> e in categoryUnits.entries) {
        for (final String unit in e.value.units) {
          expect(knownPantryUnits, contains(unit), reason: '${e.key}: $unit');
        }
      }
      for (final String unit in recipeUnits) {
        expect(knownPantryUnits, contains(unit), reason: 'recipe: $unit');
      }
    });

    test('pack is not a separate unit (it is packet)', () {
      expect(
        unitsForCategory('bakery'),
        <String>['piece', 'slice', 'loaf', 'g', 'packet'],
      );
    });

    test('recipe units are the recipe-relevant union', () {
      expect(recipeUnits, <String>[
        'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'bunch', 'pinch', 'packet',
        'jar', 'bottle',
      ]);
    });

    test('matches docs/catalog/ingredients.csv (union per app_category)', () {
      final File csv = File('../docs/catalog/ingredients.csv');
      expect(
        csv.existsSync(),
        isTrue,
        reason: 'docs/catalog/ingredients.csv must be reachable from mobile/',
      );
      final List<String> lines = csv.readAsLinesSync();
      final List<String> header = lines.first.split(',');
      final int catIdx = header.indexOf('app_category');
      final int unitsIdx = header.indexOf('allowed_units');
      final int defIdx = header.indexOf('default_unit');
      final Map<String, Set<String>> union = <String, Set<String>>{};
      final Map<String, Set<String>> defaults = <String, Set<String>>{};
      for (final String line in lines.skip(1).where((String l) => l.isNotEmpty)) {
        final List<String> cols = _splitCsvLine(line);
        union.putIfAbsent(cols[catIdx], () => <String>{})
            .addAll(cols[unitsIdx].split('|').map(_catalogUnit));
        defaults
            .putIfAbsent(cols[catIdx], () => <String>{})
            .add(_catalogUnit(cols[defIdx]));
      }
      expect(union.keys.toSet(), categoryUnits.keys.toSet());
      union.forEach((String category, Set<String> units) {
        expect(unitsForCategory(category).toSet(), units, reason: category);
        expect(
          units.containsAll(defaults[category]!),
          isTrue,
          reason: '$category csv defaults inside allowed',
        );
      });
    });
  });
}
