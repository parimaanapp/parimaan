import 'package:drift/drift.dart';

import '../../../features/pantry/domain/pantry_item.dart';
import '../app_database.dart';
import '../tables/pantry_items_table.dart';

part 'pantry_dao.g.dart';

/// The only thing in this codebase that touches [PantryItemsTable] directly
/// (W5 S7's own design rule — see `app_database.dart`'s doc). Every method
/// takes and returns the domain `PantryItem`, never a generated Drift row
/// type, so a Drift type can never leak past this boundary into
/// `features/pantry/`.
@DriftAccessor(tables: <Type>[PantryItemsTable])
class PantryDao extends DatabaseAccessor<AppDatabase> with _$PantryDaoMixin {
  PantryDao(super.db);

  /// One-shot read for the hydrate step of `PantryController`'s
  /// hydrate-then-fetch — not a `Stream`/`watch`, since the network fetch
  /// that follows is what keeps the screen live, not this cache.
  Future<List<PantryItem>> readPantryItems(String householdId) async {
    final List<PantryItemsTableData> rows = await (select(
      pantryItemsTable,
    )..where((PantryItemsTable t) => t.householdId.equals(householdId))).get();
    return rows.map(_toDomain).toList(growable: false);
  }

  /// Wholesale overwrite for [householdId]: deletes every cached row for it
  /// and inserts [items] in one transaction — no field-level merge, matching
  /// SD §9.1's staleness policy (the network result always wins outright).
  Future<void> replaceAll(String householdId, List<PantryItem> items) {
    return transaction(() async {
      await (delete(
        pantryItemsTable,
      )..where((PantryItemsTable t) => t.householdId.equals(householdId))).go();
      await batch((Batch b) {
        b.insertAll(
          pantryItemsTable,
          items.map(_toCompanion).toList(growable: false),
        );
      });
    });
  }

  /// Evicts one household's cached rows — called on active-household switch.
  Future<void> clearHousehold(String householdId) => (delete(
    pantryItemsTable,
  )..where((PantryItemsTable t) => t.householdId.equals(householdId))).go();

  /// Evicts every cached row, regardless of household — called on sign-out.
  /// A pantry cache surviving sign-out on a shared family phone would be a
  /// privacy leak (see `app_database.dart`'s doc).
  Future<void> clearAll() => delete(pantryItemsTable).go();

  PantryItem _toDomain(PantryItemsTableData row) => PantryItem(
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    isStaple: row.isStaple,
    expiryDate: row.expiryDate,
    lowThreshold: row.lowThreshold,
    addedBy: row.addedBy,
    // `.toUtc()`: Drift returns a local-time `DateTime` from a `DateTimeColumn`
    // (same instant, `isUtc: false`) — and Dart's `DateTime.==` considers
    // `isUtc` part of equality, not just the instant, so a value read back
    // without this never compares equal to the UTC `DateTime`
    // `pantry_mapper.dart`'s `DateTime.parse` on an `AWSDateTime` produces.
    addedAt: row.addedAt.toUtc(),
    updatedAt: row.updatedAt.toUtc(),
  );

  PantryItemsTableCompanion _toCompanion(PantryItem item) =>
      PantryItemsTableCompanion.insert(
        id: item.id,
        householdId: item.householdId,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: Value<String?>(item.category),
        isStaple: item.isStaple,
        expiryDate: Value<String?>(item.expiryDate),
        lowThreshold: Value<double?>(item.lowThreshold),
        addedBy: item.addedBy,
        addedAt: item.addedAt,
        updatedAt: item.updatedAt,
      );
}
