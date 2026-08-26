import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'daos/pantry_dao.dart';
import 'tables/pantry_items_table.dart';

part 'app_database.g.dart';

/// The app's on-device read cache (W5 S7) — `Drift`, confirmed against
/// SD §9.1's locked choice (see this file's own package-level doc in
/// `pubspec.yaml` for the adopt-vs-alternative research). **Read cache
/// only**: nothing in `features/*/data/` ever writes here directly except
/// as the last step of a successful network fetch — mutations always go
/// straight to the network first (SD §9.1), and this database exists to
/// make the *next* cold start of a screen show something instead of a
/// blank spinner while that network round trip is in flight.
///
/// Uses `getApplicationDocumentsDirectory()` (via [driftDatabase]'s own
/// default) — app-private storage, never shared/external. Cleared on
/// sign-out ([AuthController.signOut] calls [PantryDao.clearAll]) — a
/// pantry cache surviving sign-out on a shared family phone would be a
/// privacy leak, the same concern that already keeps
/// `shared/graphql/client.dart`'s Ferry cache in-memory-only.
/// [PantryDao.clearHousehold] exists for the household-switch case the
/// plan also calls for, but has no caller yet: there is no
/// household-switcher UI in the app today (`activeHouseholdProvider`'s own
/// doc — "first" is the only order-independent answer available until one
/// exists), so there is nothing to wire it to. Every read is already
/// scoped to one `householdId` regardless, so this is a storage-hygiene
/// gap, not a correctness one.
///
/// **Not excluded from iOS iCloud / Android auto-backup.** Deliberate, not
/// an oversight: the only exclusion mechanism available without extra
/// platform code is `getApplicationSupportDirectory()`'s "Caches"-style
/// location, which the OS can purge at any time — defeating the purpose of
/// a cache meant to survive between launches. Content is household
/// grocery-item names/quantities, not credentials or other sensitive PII,
/// so the tradeoff favors durability.
@DriftDatabase(tables: <Type>[PantryItemsTable], daos: <Type>[PantryDao])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor])
    : super(executor ?? driftDatabase(name: 'parimaan'));

  /// Only one schema version has ever shipped — no real migration exists
  /// yet. `MigrationStrategy.onUpgrade` is still wired (not left as the
  /// drift default, which throws) so the *path* is proven now — before a
  /// real v2 needs it in anger — rather than discovered broken the first
  /// time a table actually changes. See `app_database_migration_test.dart`.
  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (Migrator m) => m.createAll(),
    onUpgrade: (Migrator m, int from, int to) async {
      // Nothing to do yet — schemaVersion has only ever been 1. A future
      // migration adds its `if (from < N)` step here, matching drift's own
      // documented incremental-migration pattern.
    },
  );
}

/// Injection point for the app's single [AppDatabase] instance — same
/// no-default, composition-root-overridden shape as `ferryClientProvider`
/// (`shared/graphql/client.dart`). One instance for the whole app, not a
/// per-screen thing: every feature's DAO reaches the same underlying file.
final Provider<AppDatabase> appDatabaseProvider = Provider<AppDatabase>(
  (Ref ref) => throw UnimplementedError(
    'appDatabaseProvider must be overridden — see main.dart (production) or '
    'test overrides (tests).',
  ),
);

/// The production [AppDatabase] override — opens the real on-device file
/// (via [driftDatabase]'s default `getApplicationDocumentsDirectory()`
/// location) and closes it when the provider container is torn down.
Override appDatabaseOverride() => appDatabaseProvider.overrideWith((Ref ref) {
  final AppDatabase db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});
