import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Raw SQL via `pgm.sql()`, matching the established pattern in
// 1787072268736_baseline-schema.ts, 1787124517648_app-role.ts,
// 1787670947641_pantry-items.ts, and 1787808112003_recipes.ts: RLS policies,
// CHECK constraints, and GRANT don't have a clean high-level API in
// node-pg-migrate.

const APP_ROLE = 'parimaan_app';

const createNotificationPreferencesTable = (pgm: MigrationBuilder): void => {
  // DDL matches SYSTEM_DESIGN.md §7.1 (lines 912-921) exactly — no W8
  // deviations, unlike recipes' `updated_at`/`cuisine_tier1` additions.
  // `fcm_token` is a device push credential; it stays a real column here
  // (W20 still needs somewhere to store it) but is deliberately never
  // exposed through the GraphQL SDL (E2E_MVP_PLAN.md §14.2.6) — S8 enforces
  // that at the schema layer, not this migration.
  pgm.sql(`
    CREATE TABLE notification_preferences (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      list_changes BOOLEAN NOT NULL DEFAULT TRUE,
      meal_reminder BOOLEAN NOT NULL DEFAULT TRUE,
      expiry BOOLEAN NOT NULL DEFAULT TRUE,
      activity BOOLEAN NOT NULL DEFAULT TRUE,
      fcm_token TEXT,
      PRIMARY KEY (user_id, household_id)
    );

    -- The composite PK only indexes household_id as its trailing column, so
    -- it cannot serve a plain WHERE household_id = $1 lookup or the
    -- household-side ON DELETE CASCADE scan. Every other household-scoped
    -- table in this schema indexes its household_id FK explicitly
    -- (idx_recipes_household, idx_pantry_items_household, etc.) — this
    -- matches that convention, and also serves W20's eventual push-fanout
    -- query (WHERE household_id = $1 AND activity = TRUE).
    CREATE INDEX idx_notification_preferences_household ON notification_preferences(household_id);
  `);
};

const enableRls = (pgm: MigrationBuilder): void => {
  // Deliberately NOT the membership-subquery shape every other
  // household-scoped table uses (`recipes`, `pantry_items`,
  // `household_settings`) — E2E_MVP_PLAN.md §14.2.7. This table is
  // per-user: member B must never read or write member A's row, both
  // because preferences are personal and because the row carries
  // `fcm_token`, a device push credential whose leak lets another
  // member's device be targeted directly. `FOR ALL USING (...) WITH CHECK
  // (...)` both reference `user_id` alone — a household-scoped policy here
  // would pass a naive test suite and be a real vulnerability.
  //
  // `WITH CHECK` explicit alongside `USING` (§11.2.2's lesson, restated in
  // §14.2.7): `USING` alone governs SELECT/UPDATE/DELETE visibility but does
  // nothing to stop an INSERT of a row for a different `user_id`. `FORCE`,
  // not just `ENABLE`, so the policy still applies if this table's owner
  // role is ever used to connect directly.
  pgm.sql(`
    ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

    CREATE POLICY notification_preferences_own_row ON notification_preferences
      FOR ALL
      USING (user_id = current_setting('parimaan.user_id')::UUID)
      WITH CHECK (user_id = current_setting('parimaan.user_id')::UUID);
  `);
};

const grantAppRole = (pgm: MigrationBuilder): void => {
  // Kept in this new migration rather than the applied
  // `1787124517648_app-role.ts`'s `BASELINE_TABLES` list, same reasoning as
  // `pantry-items`/`recipes`: those migrations have already run in every
  // deployed environment, and there is no `ALTER DEFAULT PRIVILEGES` in this
  // schema, so `parimaan_app` has zero access to a new table until
  // explicitly granted (E2E_MVP_PLAN.md §11.2.3).
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO ${APP_ROLE};
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  createNotificationPreferencesTable(pgm);
  enableRls(pgm);
  grantAppRole(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // No explicit REVOKE — GRANT is table-scoped, and DROP TABLE removes the
  // table's ACL entries (and its RLS policy) along with it.
  pgm.sql(`
    DROP TABLE IF EXISTS notification_preferences;
  `);
}
