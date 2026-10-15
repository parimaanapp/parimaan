import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_category.dart';

void main() {
  group('knownPantryCategories', () {
    test('matches the server-side canonical set exactly', () {
      expect(knownPantryCategories, <String>[
        'dal',
        'grain',
        'spice',
        'dairy',
        'eggs',
        'produce',
        'dry_goods',
        'oil',
        'meat_fish',
        'condiment',
        'bakery',
        'snacks',
        'beverages',
        'frozen',
        'other',
      ]);
    });
  });

  group('pantryCategoryLabel', () {
    test('uses the founder-approved labels', () {
      expect(
        <String>[
          for (final String c in knownPantryCategories) pantryCategoryLabel(c),
        ],
        <String>[
          'Dal',
          'Grain',
          'Spice',
          'Dairy',
          'Eggs',
          'Produce',
          'Dry Goods',
          'Oil',
          'Meat & Fish',
          'Condiment',
          'Bakery',
          'Snacks',
          'Beverages',
          'Frozen',
          'Other',
        ],
      );
    });

    test('falls back to a humanised label for an unknown category', () {
      expect(pantryCategoryLabel('festival_snacks'), 'Festival snacks');
      expect(pantryCategoryLabel(''), '');
    });
  });
}
