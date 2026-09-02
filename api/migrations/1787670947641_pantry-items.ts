import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Written as raw SQL via `pgm.sql()`, matching the established pattern in
// 1787072268736_baseline-schema.ts and 1787124517648_app-role.ts: RLS
// policies, CHECK constraints, and GRANT don't have a clean high-level API
// in node-pg-migrate.

const APP_ROLE = 'parimaan_app';

const createPantryItemsTable = (pgm: MigrationBuilder): void => {
  // DDL matches SYSTEM_DESIGN.md §7.1 verbatim — `unit`/`category` stay
  // free-text TEXT columns here (canonicalisation is server-side in the
  // resolver slice, `api/src/domain/pantryUnits.ts`/`pantryCategories.ts`,
  // not a schema-level enum: E2E_MVP_PLAN.md §11.2.4) and `expiry_date`
  // stays a plain `DATE` (the SDL-side `AWSDate` mismatch fix is §11.2.5,
  // also not a schema change).
  pgm.sql(`
    CREATE TABLE pantry_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      category TEXT,
      is_staple BOOLEAN NOT NULL DEFAULT FALSE,
      expiry_date DATE,
      low_threshold NUMERIC,
      added_by UUID NOT NULL REFERENCES users(id),
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_pantry_household ON pantry_items(household_id);
    CREATE INDEX idx_pantry_household_name ON pantry_items(household_id, LOWER(name));
  `);
};

const enableRls = (pgm: MigrationBuilder): void => {
  // SYSTEM_DESIGN.md §7.1's example policy is `USING (...)` only. `USING`
  // governs SELECT/UPDATE/DELETE row *visibility*; `WITH CHECK` governs
  // INSERT (and re-checks UPDATE's new row). For a `FOR ALL` policy that
  // omits `WITH CHECK` explicitly, Postgres implicitly reuses `USING` as
  // the check — confirmed empirically in W8 S11's phase-boundary sweep
  // (E2E_MVP_PLAN.md §14.5) against `household_settings`'s identically-
  // shaped policy, which was long tracked here as an untested INSERT gap
  // and turned out not to be one. Both clauses are made explicit on both
  // sides anyway, for the same reason S11 then added an explicit
  // `WITH CHECK` to `household_settings` too
  // (`1788000000000_household-settings-with-check.ts`): the implicit reuse
  // stops applying the moment a policy is ever split into separate
  // per-command policies, and an explicit clause here means that future
  // change can't silently reopen a real gap.
  //
  // `FORCE ROW LEVEL SECURITY` (not just `ENABLE`) so the policy still
  // applies even if this table's owner role is ever used to connect —
  // `ENABLE` alone exempts the owner, same defense-in-depth reasoning as
  // `1787124517648_app-role.ts`'s `FORCE` on `household_settings`.
  pgm.sql(`
    ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pantry_items FORCE ROW LEVEL SECURITY;

    CREATE POLICY pantry_household_member ON pantry_items
      FOR ALL
      USING (
        household_id IN (
          SELECT household_id FROM household_memberships
          WHERE user_id = current_setting('parimaan.user_id')::UUID
        )
      )
      WITH CHECK (
        household_id IN (
          SELECT household_id FROM household_memberships
          WHERE user_id = current_setting('parimaan.user_id')::UUID
        )
      );
  `);
};

const grantAppRole = (pgm: MigrationBuilder): void => {
  // Kept in this new migration rather than added to the applied
  // `1787124517648_app-role.ts`'s `BASELINE_TABLES` list — that migration
  // has already run in every deployed environment; editing it would not
  // re-apply here. Every new table needs its own explicit grant
  // (E2E_MVP_PLAN.md §11.2.3): there is no `ALTER DEFAULT PRIVILEGES` in
  // this schema, so `parimaan_app` has zero access to a new table until
  // granted.
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON pantry_items TO ${APP_ROLE};
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  createPantryItemsTable(pgm);
  enableRls(pgm);
  grantAppRole(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // No explicit REVOKE: GRANT is table-scoped, and `DROP TABLE` removes the
  // table's ACL entries (and its RLS policy) along with it. This matters for
  // ordering against `1787124517648_app-role.ts`'s own `down()`, which runs
  // *after* this one (node-pg-migrate reverses newest-first) and explicitly
  // REVOKEs+DROPs the `parimaan_app` role — by the time that runs,
  // pantry_items and its grants are already gone, so there is nothing left
  // for that REVOKE to conflict with.
  pgm.sql(`
    DROP TABLE IF EXISTS pantry_items;
  `);
}
