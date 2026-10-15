import 'dart:io';

import 'package:drift/drift.dart' hide isNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/shared/storage/app_database.dart';

/// A fabricated "next version" of [AppDatabase] — schemaVersion 1 has only
/// ever shipped, so there is no real v2 to test against yet. This proves
/// `MigrationStrategy.onUpgrade` itself runs correctly on an existing
/// database (schema changes without losing rows) before a real migration
/// needs it in anger (E2E_MVP_PLAN.md §11.3 S7 step 3).
class _V2Database extends AppDatabase {
  _V2Database(super.executor);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (Migrator m) => m.createAll(),
    onUpgrade: (Migrator m, int from, int to) async {
      if (from < 2) {
        // A raw ALTER TABLE, not `Migrator.addColumn` — deliberately not
        // wired to any Dart-side column, so this test proves the migration
        // *mechanism* without adding an unused column to the real schema.
        await m.database.customStatement(
          'ALTER TABLE pantry_items_table ADD COLUMN notes TEXT',
        );
      }
    },
  );
}

void main() {
  test(
    'a v1→v2 schema migration runs and preserves already-cached rows',
    () async {
      final Directory tempDir = await Directory.systemTemp.createTemp(
        'parimaan_migration_test',
      );
      final File dbFile = File('${tempDir.path}/test.sqlite');
      addTearDown(() => tempDir.delete(recursive: true));

      final PantryItem item = PantryItem(
        id: 'item-1',
        householdId: 'household-1',
        name: 'Toor Dal',
        quantity: 2,
        unit: 'kg',
        category: 'dal',
        isStaple: true,
        addedBy: 'user-1',
        addedAt: DateTime.utc(2026, 8, 26, 10),
        updatedAt: DateTime.utc(2026, 8, 26, 11),
      );

      // Opens at schemaVersion 1 (today's only-ever-shipped schema, via
      // `onCreate`), writes a row, then closes — simulating a device that
      // has been running the app before a v2 ever existed.
      final AppDatabase v1 = AppDatabase(NativeDatabase(dbFile));
      await v1.pantryDao.replaceAll('household-1', <PantryItem>[item]);
      await v1.close();

      // Reopens the same file as the fabricated v2 — drift compares the
      // stored `PRAGMA user_version` (1) against `schemaVersion` (2) and
      // runs `onUpgrade` automatically.
      final _V2Database v2 = _V2Database(NativeDatabase(dbFile));
      addTearDown(v2.close);

      final List<PantryItem> survived = await v2.pantryDao.readPantryItems(
        'household-1',
      );
      expect(survived, <PantryItem>[item]);

      // The migration's own ALTER TABLE actually ran, not silently skipped.
      final List<Map<String, Object?>> notesColumn = await v2
          .customSelect("SELECT notes FROM pantry_items_table WHERE id = 'item-1'")
          .get()
          .then(
            (List<QueryRow> rows) => rows.map((QueryRow r) => r.data).toList(),
          );
      expect(notesColumn, hasLength(1));
      expect(notesColumn.single['notes'], isNull);
    },
  );
}
