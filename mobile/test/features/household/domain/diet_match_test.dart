import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/diet_match.dart';

/// Reads the table shared with `api/src/domain/dietMatch.fixtures.test.ts`, so
/// the TS and Dart implementations cannot drift. `flutter test` runs with the
/// package (`mobile/`) as the working directory.
List<Map<String, dynamic>> _loadCases() {
  final File file = File('../shared/fixtures/dietMatch-cases.json');
  final Map<String, dynamic> decoded =
      jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  return (decoded['cases'] as List<dynamic>).cast<Map<String, dynamic>>();
}

List<String> _strings(dynamic value) =>
    (value as List<dynamic>).cast<String>();

void main() {
  group('isRecipeEligible — shared fixture table', () {
    final List<Map<String, dynamic>> cases = _loadCases();

    test('the fixture table is non-empty', () {
      expect(cases, isNotEmpty);
    });

    for (final Map<String, dynamic> c in cases) {
      final List<String> household = _strings(c['household']);
      final List<String> recipe = _strings(c['recipe']);
      test('household $household vs recipe $recipe', () {
        expect(isRecipeEligible(recipe, household), c['eligible'] as bool);
      });
    }
  });

  group('unmetHouseholdTags', () {
    test('is empty when the recipe is eligible', () {
      expect(
        unmetHouseholdTags(<String>['veg'], <String>['veg', 'eggetarian']),
        isEmpty,
      );
      expect(unmetHouseholdTags(<String>['veg'], <String>['non_veg']), isEmpty);
    });

    test('reports every household style when no style is satisfied', () {
      expect(
        unmetHouseholdTags(<String>['non_veg'], <String>['veg', 'eggetarian']),
        <String>['veg', 'eggetarian'],
      );
    });

    test('reports only the missing modifiers when the style is satisfied', () {
      expect(
        unmetHouseholdTags(
          <String>['veg', 'gluten_free'],
          <String>['veg', 'gluten_free', 'dairy_free'],
        ),
        <String>['dairy_free'],
      );
    });

    test('a vegan recipe satisfies dairy_free', () {
      expect(
        unmetHouseholdTags(<String>['vegan'], <String>['veg', 'dairy_free']),
        isEmpty,
      );
    });

    test('keeps the household tag order and ignores unknown tags', () {
      expect(
        unmetHouseholdTags(<String>[], <String>['dairy_free', 'keto', 'veg']),
        <String>['dairy_free', 'veg'],
      );
    });
  });
}
