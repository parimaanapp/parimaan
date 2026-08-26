import 'package:drift/drift.dart';

/// The on-device read cache of one household's pantry (W5 S7). Mirrors
/// `features/pantry/domain/pantry_item.dart` field-for-field — this table
/// exists purely to hold what the server already returned, never as a
/// second source of truth network mutations write to directly (mutations
/// always go straight to the network; see `pantry_dao.dart`'s doc).
///
/// `id` is the primary key, not `(householdId, id)`: item ids are already
/// globally unique (server-generated UUIDs), and a compound key would only
/// complicate `replaceAll`'s per-household wholesale-overwrite delete.
class PantryItemsTable extends Table {
  TextColumn get id => text()();
  TextColumn get householdId => text()();
  TextColumn get name => text()();
  RealColumn get quantity => real()();
  TextColumn get unit => text()();
  TextColumn get category => text().nullable()();
  BoolColumn get isStaple => boolean()();

  /// `YYYY-MM-DD`, stored as text — same rationale as the domain type's own
  /// `expiryDate` field: never parsed to a `DateTime`, which would attach a
  /// spurious time-of-day/timezone this value never had.
  TextColumn get expiryDate => text().nullable()();
  RealColumn get lowThreshold => real().nullable()();
  TextColumn get addedBy => text()();
  DateTimeColumn get addedAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}
