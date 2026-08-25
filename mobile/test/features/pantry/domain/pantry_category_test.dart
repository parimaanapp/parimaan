import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_category.dart';

void main() {
  group('knownPantryCategories', () {
    test('matches the server-side canonical set exactly', () {
      expect(knownPantryCategories, <String>[
        'dal',
        'spice',
        'dairy',
        'produce',
        'dry_goods',
        'grain',
        'oil',
        'condiment',
        'frozen',
        'other',
      ]);
    });
  });

  group('pantryCategoryLabel', () {
    test('replaces underscores with spaces and title-cases the result', () {
      expect(pantryCategoryLabel('dry_goods'), 'Dry goods');
      expect(pantryCategoryLabel('dal'), 'Dal');
    });
  });
}
