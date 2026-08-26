import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/shared/storage/app_database.dart';

PantryItem _item({
  String id = 'item-1',
  String householdId = 'household-1',
  String name = 'Toor Dal',
  double quantity = 2,
  String unit = 'kg',
  String? category = 'dal',
  bool isStaple = true,
  String? expiryDate,
  double? lowThreshold,
}) => PantryItem(
  id: id,
  householdId: householdId,
  name: name,
  quantity: quantity,
  unit: unit,
  category: category,
  isStaple: isStaple,
  expiryDate: expiryDate,
  lowThreshold: lowThreshold,
  addedBy: 'user-1',
  addedAt: DateTime.utc(2026, 8, 26, 10),
  updatedAt: DateTime.utc(2026, 8, 26, 11),
);

void main() {
  group('PantryDao', () {
    late AppDatabase db;

    setUp(() {
      db = AppDatabase(NativeDatabase.memory());
    });

    tearDown(() => db.close());

    test('readPantryItems returns an empty list when nothing is cached', () async {
      final List<PantryItem> items = await db.pantryDao.readPantryItems('household-1');
      expect(items, isEmpty);
    });

    test('replaceAll then readPantryItems round-trips every field, including nulls', () async {
      final PantryItem item = _item(
        category: null,
        expiryDate: null,
        lowThreshold: null,
        isStaple: false,
      );
      await db.pantryDao.replaceAll('household-1', <PantryItem>[item]);

      final List<PantryItem> items = await db.pantryDao.readPantryItems('household-1');
      expect(items, <PantryItem>[item]);
    });

    test('round-trips a populated expiryDate (DATE) and lowThreshold', () async {
      final PantryItem item = _item(expiryDate: '2027-03-01', lowThreshold: 0.5);
      await db.pantryDao.replaceAll('household-1', <PantryItem>[item]);

      final List<PantryItem> items = await db.pantryDao.readPantryItems('household-1');
      expect(items.single.expiryDate, '2027-03-01');
      expect(items.single.lowThreshold, 0.5);
    });

    test('replaceAll only touches the given household — another household is untouched', () async {
      await db.pantryDao.replaceAll('household-1', <PantryItem>[_item(id: 'item-1')]);
      await db.pantryDao.replaceAll('household-2', <PantryItem>[
        _item(id: 'item-2', householdId: 'household-2'),
      ]);

      final List<PantryItem> household1 = await db.pantryDao.readPantryItems('household-1');
      final List<PantryItem> household2 = await db.pantryDao.readPantryItems('household-2');
      expect(household1.map((PantryItem i) => i.id), <String>['item-1']);
      expect(household2.map((PantryItem i) => i.id), <String>['item-2']);
    });

    test('replaceAll is a wholesale overwrite — a second call drops rows the first inserted', () async {
      await db.pantryDao.replaceAll('household-1', <PantryItem>[
        _item(id: 'item-1'),
        _item(id: 'item-2'),
      ]);

      await db.pantryDao.replaceAll('household-1', <PantryItem>[_item(id: 'item-2')]);

      final List<PantryItem> items = await db.pantryDao.readPantryItems('household-1');
      expect(items.map((PantryItem i) => i.id), <String>['item-2']);
    });

    test('clearHousehold evicts only that household', () async {
      await db.pantryDao.replaceAll('household-1', <PantryItem>[_item(id: 'item-1')]);
      await db.pantryDao.replaceAll('household-2', <PantryItem>[
        _item(id: 'item-2', householdId: 'household-2'),
      ]);

      await db.pantryDao.clearHousehold('household-1');

      expect(await db.pantryDao.readPantryItems('household-1'), isEmpty);
      expect(await db.pantryDao.readPantryItems('household-2'), isNotEmpty);
    });

    test('clearAll evicts every household', () async {
      await db.pantryDao.replaceAll('household-1', <PantryItem>[_item(id: 'item-1')]);
      await db.pantryDao.replaceAll('household-2', <PantryItem>[
        _item(id: 'item-2', householdId: 'household-2'),
      ]);

      await db.pantryDao.clearAll();

      expect(await db.pantryDao.readPantryItems('household-1'), isEmpty);
      expect(await db.pantryDao.readPantryItems('household-2'), isEmpty);
    });
  });
}
