import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Fixes a real bug in `1787808112003_recipes.ts` (already applied to dev):
// that migration's `cuisine_tier1` CHECK used
// ('north_indian','south_indian','pan_indian','other') — a typo
// ('pan_indian' instead of 'pan_india') plus an invented 'other' value,
// while the actual locked `CuisineTier1` enum (`shared/schema.graphql`,
// already in use by `household_settings.cuisine_tier1` and validated in
// `api/src/validation/updateHouseholdSettings.ts`) is
// ('north_indian','south_indian','pan_india','indo_chinese','continental').
// Caught while building W6 S2 (E2E_MVP_PLAN.md §12.3), which needed the
// canonical value list for `api/src/domain/cuisineTiers.ts` and found the
// migration's own CHECK disagreed with it. A migration already applied in
// any environment is never edited in place (same convention as every other
// migration in this repo) — this is a separate, additive fix.

const CUISINE_TIER1_VALUES = [
  'north_indian',
  'south_indian',
  'pan_india',
  'indo_chinese',
  'continental',
] as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE recipes DROP CONSTRAINT recipes_cuisine_tier1_check;
    ALTER TABLE recipes ADD CONSTRAINT recipes_cuisine_tier1_check
      CHECK (cuisine_tier1 IS NULL OR cuisine_tier1 IN (${CUISINE_TIER1_VALUES.map((v) => `'${v}'`).join(',')}));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Restores the original (buggy) constraint from 1787808112003_recipes.ts
  // — a `down()` must reverse exactly what this migration's `up()` did, not
  // "fix the fix"; if `1787808112003_recipes.ts` is itself rolled back
  // afterward, this constraint goes with the whole table anyway.
  pgm.sql(`
    ALTER TABLE recipes DROP CONSTRAINT recipes_cuisine_tier1_check;
    ALTER TABLE recipes ADD CONSTRAINT recipes_cuisine_tier1_check
      CHECK (cuisine_tier1 IS NULL OR cuisine_tier1 IN ('north_indian','south_indian','pan_indian','other'));
  `);
}

