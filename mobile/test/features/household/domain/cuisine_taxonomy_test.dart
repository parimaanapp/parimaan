import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/cuisine_taxonomy.dart';

void main() {
  group('CuisineRegion', () {
    test('wire values match shared/schema.graphql CuisineTier1 exactly', () {
      expect(
        CuisineRegion.values.map((CuisineRegion r) => r.wireValue).toList(),
        <String>[
          'north_indian',
          'south_indian',
          'pan_india',
          'indo_chinese',
          'continental',
        ],
      );
    });

    test('display labels are the wireframe chip copy', () {
      expect(CuisineRegion.northIndian.displayLabel, 'North Indian');
      expect(CuisineRegion.southIndian.displayLabel, 'South Indian');
      expect(CuisineRegion.panIndia.displayLabel, 'Pan-India');
      expect(CuisineRegion.indoChinese.displayLabel, 'Indo-Chinese');
      expect(CuisineRegion.continental.displayLabel, 'Continental');
    });

    test('defaults are the first three, as the wireframe draws them', () {
      expect(defaultCuisineRegions, <CuisineRegion>{
        CuisineRegion.northIndian,
        CuisineRegion.southIndian,
        CuisineRegion.panIndia,
      });
    });
  });

  group('CuisineBias', () {
    test('wire values are the server enum — normal, never "same"', () {
      expect(
        CuisineBias.values.map((CuisineBias b) => b.wireValue).toList(),
        <String>['less', 'normal', 'more'],
      );
      expect(
        CuisineBias.values.map((CuisineBias b) => b.wireValue),
        isNot(contains('same')),
      );
    });

    test('the UI says "Same" where the wire says "normal"', () {
      expect(CuisineBias.less.displayLabel, 'Less');
      expect(CuisineBias.normal.displayLabel, 'Same');
      expect(CuisineBias.more.displayLabel, 'More');
    });

    test('normal is the default bias', () {
      expect(CuisineBias.defaultBias, CuisineBias.normal);
    });
  });

  group('sub-cuisine taxonomy (PRD §7.3)', () {
    test('North Indian carries the five PRD-documented sub-cuisines', () {
      expect(
        subCuisinesOf(CuisineRegion.northIndian)
            .map((SubCuisine s) => s.displayLabel)
            .toList(),
        <String>['Punjabi', 'UP/Bihari', 'Rajasthani', 'Gujarati', 'Marathi'],
      );
    });

    test('South Indian carries the four PRD-documented sub-cuisines', () {
      expect(
        subCuisinesOf(CuisineRegion.southIndian)
            .map((SubCuisine s) => s.displayLabel)
            .toList(),
        <String>['Tamil', 'Kerala/Malayali', 'Andhra/Telangana', 'Karnataka'],
      );
    });

    test(
      'Pan-India, Indo-Chinese and Continental have none — the PRD documents '
      'no sub-cuisines for them and none are invented here',
      () {
        expect(subCuisinesOf(CuisineRegion.panIndia), isEmpty);
        expect(subCuisinesOf(CuisineRegion.indoChinese), isEmpty);
        expect(subCuisinesOf(CuisineRegion.continental), isEmpty);
      },
    );

    test('every key is snake_case and within the server 40-char bound', () {
      final RegExp snakeCase = RegExp(r'^[a-z][a-z0-9_]*$');
      for (final CuisineRegion region in CuisineRegion.values) {
        for (final SubCuisine sub in subCuisinesOf(region)) {
          expect(snakeCase.hasMatch(sub.key), isTrue, reason: sub.key);
          expect(sub.key.length, lessThanOrEqualTo(maxCuisineTier2KeyLength));
        }
      }
    });

    test('keys are unique across the whole taxonomy', () {
      final List<String> keys = CuisineRegion.values
          .expand(subCuisinesOf)
          .map((SubCuisine s) => s.key)
          .toList();

      expect(keys.toSet(), hasLength(keys.length));
    });

    test('the whole taxonomy fits inside the server 20-key bound', () {
      expect(
        CuisineRegion.values.expand(subCuisinesOf).length,
        lessThanOrEqualTo(maxCuisineTier2Keys),
      );
    });
  });

  group('subCuisinesForRegions', () {
    test('flattens the selected regions in taxonomy order', () {
      expect(
        subCuisinesForRegions(<CuisineRegion>{
          CuisineRegion.southIndian,
          CuisineRegion.northIndian,
        }).map((SubCuisine s) => s.key).first,
        'punjabi',
      );
    });

    test('an unselected region contributes nothing', () {
      final List<SubCuisine> subs = subCuisinesForRegions(<CuisineRegion>{
        CuisineRegion.northIndian,
      });

      expect(subs, hasLength(5));
      expect(subs.map((SubCuisine s) => s.key), isNot(contains('tamil')));
    });

    test('no regions selected yields no sub-cuisines', () {
      expect(subCuisinesForRegions(const <CuisineRegion>{}), isEmpty);
    });
  });

  group('encodeCuisineTier2Weights', () {
    test('encodes to a JSON string of key -> wire bias', () {
      final String wire = encodeCuisineTier2Weights(<String, CuisineBias>{
        'punjabi': CuisineBias.more,
        'marathi': CuisineBias.normal,
        'gujarati': CuisineBias.less,
      });

      expect(jsonDecode(wire), <String, Object?>{
        'punjabi': 'more',
        'marathi': 'normal',
        'gujarati': 'less',
      });
    });

    test('a "Same" selection serializes as normal, not same', () {
      expect(
        encodeCuisineTier2Weights(<String, CuisineBias>{
          'tamil': CuisineBias.normal,
        }),
        '{"tamil":"normal"}',
      );
    });

    test('an empty map is still a valid JSON object', () {
      expect(encodeCuisineTier2Weights(const <String, CuisineBias>{}), '{}');
    });
  });

  group('defaultWeightsFor', () {
    test('gives every sub-cuisine of the selected regions a normal bias', () {
      final Map<String, CuisineBias> weights = defaultWeightsFor(
        <CuisineRegion>{CuisineRegion.northIndian},
      );

      expect(weights, hasLength(5));
      expect(weights.values, everyElement(CuisineBias.normal));
      expect(weights.keys, contains('punjabi'));
    });

    test('keeps a bias the caller already chose', () {
      final Map<String, CuisineBias> weights = defaultWeightsFor(
        <CuisineRegion>{CuisineRegion.northIndian},
        existing: <String, CuisineBias>{'punjabi': CuisineBias.more},
      );

      expect(weights['punjabi'], CuisineBias.more);
      expect(weights['marathi'], CuisineBias.normal);
    });

    test('drops a bias whose region is no longer selected', () {
      final Map<String, CuisineBias> weights = defaultWeightsFor(
        <CuisineRegion>{CuisineRegion.southIndian},
        existing: <String, CuisineBias>{'punjabi': CuisineBias.more},
      );

      expect(weights.keys, isNot(contains('punjabi')));
    });
  });
}
