import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/catalog/domain/catalog_ingredient.dart';

const CatalogIngredient _toorDal = CatalogIngredient(
  id: 'toor_dal',
  name: 'Toor Dal',
  category: 'dal',
  categoryLabel: 'Dal',
  allowedUnits: <String>['g', 'kg', 'cup'],
  defaultUnit: 'g',
  aliases: <String>['arhar', 'tuvar', 'pigeon pea'],
);

void main() {
  group('matchedAlias', () {
    test('is null when the canonical name matches the query', () {
      expect(matchedAlias(_toorDal, 'toor'), isNull);
      expect(matchedAlias(_toorDal, 'dal'), isNull);
    });

    test('returns the alias that carried the match', () {
      expect(matchedAlias(_toorDal, 'arh'), 'arhar');
      expect(matchedAlias(_toorDal, 'TUVAR'), 'tuvar');
    });

    test('is null for a blank query or when nothing matches', () {
      expect(matchedAlias(_toorDal, '   '), isNull);
      expect(matchedAlias(_toorDal, 'zzz'), isNull);
    });

    test('folds a plural query onto the alias', () {
      expect(matchedAlias(_toorDal, 'arhars'), 'arhar');
    });
  });

  group('selectionFor', () {
    test('keeps the selection while the text still names it', () {
      expect(selectionFor(_toorDal, ' toor dal '), _toorDal);
    });

    test('drops the selection once the text no longer names it', () {
      expect(selectionFor(_toorDal, 'Toor Dal and more'), isNull);
      expect(selectionFor(null, 'Toor Dal'), isNull);
    });
  });

  group('unitsForIngredient', () {
    test('is limited to the catalog row allowed units, default first', () {
      expect(
        unitsForIngredient(_toorDal, fallback: const <String>['tsp']),
        <String>['g', 'kg', 'cup'],
      );
    });

    test('appends an existing out-of-list unit so it never disappears', () {
      expect(
        unitsForIngredient(
          _toorDal,
          fallback: const <String>['tsp'],
          current: 'packet',
        ),
        <String>['g', 'kg', 'cup', 'packet'],
      );
    });

    test('uses the fallback for free text (no catalog row)', () {
      expect(
        unitsForIngredient(null, fallback: const <String>['g', 'tsp']),
        <String>['g', 'tsp'],
      );
    });
  });

  group('unitAfterSelection', () {
    test('fills the default unit into an empty unit', () {
      expect(unitAfterSelection(_toorDal, ''), 'g');
    });

    test('keeps a current unit that the ingredient allows', () {
      expect(unitAfterSelection(_toorDal, 'kg'), 'kg');
    });

    test('replaces a unit the ingredient does not allow with the default', () {
      expect(unitAfterSelection(_toorDal, 'tsp'), 'g');
    });
  });
}
