import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Raw SQL via `pgm.sql()`, matching the established pattern in
// 1787072268736_baseline-schema.ts, 1787124517648_app-role.ts,
// 1787670947641_pantry-items.ts and 1788100000000_menus.ts: RLS policies,
// CHECK constraints, GRANTs and multi-statement backfills don't have a
// clean high-level API in node-pg-migrate.

/**
 * W14 S1 (E2E_MVP_PLAN.md §20.3 "S1 — `menus.meal_config_snapshot`
 * migration + backfill", design at §20.2.1 D1 and §20.2.2 D2).
 *
 * D1 locks one combined `meal_config_snapshot JSONB NOT NULL` column on
 * `menus`, holding `{"mealsEnabled": [...], "mealStructure": {...},
 * "snapshotAt": "<ISO timestamp>"}`, written once at menu creation
 * (S2, not this slice) and never updated after insert. This migration only
 * adds the column and gets every *existing* row into a state that satisfies
 * `NOT NULL` — S2 is the slice that makes `createMenu` the column's one
 * real writer going forward.
 *
 * Three steps, in one `up()` — `ADD COLUMN` (nullable) -> backfill ->
 * `SET NOT NULL` — so there is never a window where the `NOT NULL`
 * constraint exists before every row satisfies it (a bare `ADD COLUMN ...
 * NOT NULL` with no default would fail outright against any existing row;
 * doing it in three separate migrations would instead leave a *deployed*
 * window between them where the schema disagrees with itself). node-pg-migrate
 * runs each migration file's `up()` inside a single transaction by default
 * (no `noTransaction` export here, matching every other migration in this
 * directory), so these three statements are already atomic as one unit —
 * no extra `BEGIN`/`COMMIT` needed, and a failure at any step (including the
 * loud-failure guard between backfill and `SET NOT NULL`, see below) rolls
 * back the `ADD COLUMN` too.
 */

/**
 * D2 (§20.2.2): there is no honest way to reconstruct what a household's
 * `mealsEnabled`/`mealStructure` actually was at the moment a past menu was
 * created — `household_settings` keeps no history, which is the whole
 * reason this column exists. The backfill therefore copies each existing
 * `menus` row's household's *current* `household_settings` — exactly the
 * live values every past menu was already being read against before this
 * column existed (D3, §20.2.3, ships in S3) — so the backfill changes
 * nothing about how those weeks behave; it just writes down what they were
 * already doing.
 *
 * BACKFILLED ROWS ARE AN APPROXIMATION BY CONSTRUCTION AND ARE NOT EVIDENCE
 * OF WHAT THE CONFIG WAS WHEN THOSE WEEKS WERE PLANNED. No attempt is made
 * to infer past config from the menu items already placed on a backfilled
 * row — that would be inventing data, which this codebase declines to do
 * everywhere else this class of gap shows up (`defaultExpiry.ts`'s
 * `other: null`, `canonicalizePantryUnit`'s pass-through).
 *
 * `snapshotAt` is set to this migration's own run timestamp, not a
 * fabricated creation time — `now()` inside a single `UPDATE` statement is
 * the transaction's start time, so every backfilled row gets the exact same
 * `snapshotAt`, which is the honest value: "this is when this approximation
 * was written down," not "this is when the menu was created."
 */
const backfillFromCurrentSettings = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE menus ADD COLUMN meal_config_snapshot JSONB;

    UPDATE menus
    SET meal_config_snapshot = jsonb_build_object(
      'mealsEnabled', household_settings.meals_enabled,
      'mealStructure', household_settings.meal_structure,
      'snapshotAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    FROM household_settings
    WHERE household_settings.household_id = menus.household_id;
  `);

  // D2's own stated blast-radius note: a `menus` row whose household has no
  // `household_settings` row is impossible under the current schema
  // (`insertDefaultSettings` runs inside `createHousehold`'s transaction),
  // but this migration fails loudly rather than silently defaulting or
  // leaving the row NULL going into `SET NOT NULL` below (which would just
  // turn this into a less legible failure at the next statement instead).
  // Same fail-closed posture as `getMealSlotCap`'s "malformed or missing
  // caps at zero, never at a reasonable default."
  pgm.sql(`
    DO $$
    DECLARE
      unbackfilled_count INT;
    BEGIN
      SELECT COUNT(*) INTO unbackfilled_count FROM menus WHERE meal_config_snapshot IS NULL;
      IF unbackfilled_count > 0 THEN
        RAISE EXCEPTION
          'menu-config-snapshot backfill: % menus row(s) have no matching household_settings row and could not be backfilled',
          unbackfilled_count;
      END IF;
    END $$;
  `);

  pgm.sql(`
    ALTER TABLE menus ALTER COLUMN meal_config_snapshot SET NOT NULL;
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  backfillFromCurrentSettings(pgm);

  // No new GRANT: `1788100000000_menus.ts` already grants
  // `SELECT, INSERT, UPDATE, DELETE ON menus, menu_items` to `parimaan_app`
  // table-wide, and a table-level GRANT covers every column on that table,
  // present and future — there is no per-column ACL involved anywhere in
  // this schema. Verified against that migration's `grantAppRole` rather
  // than assumed, per §11.2.3's own lesson that a missing grant fails at
  // runtime in dev AWS, not at synth (`migrations.menuConfigSnapshot.test.ts`
  // has a direct assertion of this: the real `parimaan_app` role can select
  // the new column with no further GRANT).

  // No RLS change: `menus_household_member` (also `1788100000000_menus.ts`)
  // is a row-level policy — it evaluates once per row via `household_id`
  // and gates every column on that row, including one added afterwards.
  // Believing that rather than proving it is exactly the kind of thing
  // this codebase tests once instead of assuming (§20.3's own words) —
  // `migrations.menuConfigSnapshot.test.ts` asserts a non-member is denied
  // reading a row carrying this column directly.
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Only this migration's own addition is reversed — `menus` and its RLS
  // policy/grants belong to `1788100000000_menus.ts` and are untouched
  // here. `DROP COLUMN` also drops any constraint on it (the `NOT NULL`
  // included), so nothing else needs undoing.
  pgm.sql(`
    ALTER TABLE menus DROP COLUMN IF EXISTS meal_config_snapshot;
  `);
}
