import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * W8 S11's phase-boundary security sweep (E2E_MVP_PLAN.md §14.5) re-verified
 * the `household_settings_member` policy — the audit deferred since W5
 * (§11.2.2, "separate backlog, not W5") — against a real Postgres instance,
 * not just the SQL text. Finding: it was NOT actually exploitable. `CREATE
 * POLICY ... USING (...)` with no `FOR` clause defaults to `FOR ALL`, and
 * Postgres **implicitly reuses the `USING` expression as `WITH CHECK`** for
 * a `FOR ALL` policy that omits one explicitly — confirmed empirically (a
 * cross-household INSERT/UPDATE was rejected before this migration ever
 * ran). The standing doc language calling this an unpaid critical gap
 * (`1787670947641_pantry-items.ts`'s own comment, E2E_MVP_PLAN.md §11.2.2)
 * was wrong about the actual risk, not just untested.
 *
 * This migration adds the `WITH CHECK` explicitly anyway, for the same
 * reason `pantry_items`/`recipes` both spell it out rather than relying on
 * the implicit reuse: it stops being safe the moment this policy is ever
 * split into separate `FOR SELECT`/`FOR UPDATE` policies (the implicit
 * reuse only applies to `FOR ALL`), and an explicit clause means that
 * future change can't silently reopen a real gap. Consistency with every
 * other household-scoped table's policy shape is the secondary reason.
 *
 * No new GRANT here — `household_settings` already has its table-level
 * privileges from `1787124517648_app-role.ts`'s baseline grant, and
 * replacing a policy doesn't change them.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP POLICY household_settings_member ON household_settings;

    CREATE POLICY household_settings_member ON household_settings
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
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Restores the exact pre-migration policy shape (implicit WITH CHECK via
  // FOR ALL's own default), not a no-op — a down() that left the explicit
  // WITH CHECK in place would not actually be reversing this migration.
  pgm.sql(`
    DROP POLICY household_settings_member ON household_settings;

    CREATE POLICY household_settings_member ON household_settings
      USING (
        household_id IN (
          SELECT household_id FROM household_memberships
          WHERE user_id = current_setting('parimaan.user_id')::UUID
        )
      );
  `);
}
