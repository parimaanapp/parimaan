import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/domain/cookable_pantry.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';

PantryItem _item(String name, String? category, double quantity) => PantryItem(
  id: name,
  householdId: 'h',
  name: name,
  quantity: quantity,
  unit: 'kg',
  category: category,
  isStaple: false,
  addedBy: 'u',
  addedAt: DateTime.utc(2026, 9, 29),
  updatedAt: DateTime.utc(2026, 9, 29),
);

void main() {
  test('the minimum is three, the same number the server enforces', () {
    expect(minCookablePantryItems, 3);
  });

  // The server's twin (api/src/domain/cookablePantry.ts) runs these same cases,
  // so the rule cannot drift between the client (instant, offline) and the server.
  group('the shared client/server fixture', () {
    final File file = File('../shared/fixtures/cookable-pantry-cases.json');
    if (!file.existsSync()) {
      test('skipped: shared/ not found relative to mobile/', () {
        markTestSkipped('shared/fixtures not found');
      });
      return;
    }
    final List<dynamic> cases =
        (jsonDecode(file.readAsStringSync()) as Map<String, dynamic>)['cases']
            as List<dynamic>;
    test('has cases to run', () => expect(cases.length, greaterThan(5)));
    for (final dynamic raw in cases) {
      final Map<String, dynamic> c = raw as Map<String, dynamic>;
      test(c['name'] as String, () {
        final List<PantryItem> items = (c['items'] as List<dynamic>)
            .map(
              (dynamic i) => _item(
                (i as Map<String, dynamic>)['name'] as String,
                i['category'] as String?,
                (i['quantity'] as num).toDouble(),
              ),
            )
            .toList();
        expect(isPantryTooSmall(items), c['tooSmall'] as bool);
      });
    }
  });
}
