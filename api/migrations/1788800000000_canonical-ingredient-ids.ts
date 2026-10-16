import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Raw SQL via `pgm.sql()`, same convention as the other migrations.
//
// Build B, B2b: household ingredient rows point at the global catalog.
// `ingredient_id` is nullable on purpose: a name the catalog cannot resolve
// (or resolves ambiguously) is kept as typed and never blocks a save.
// `catalog_match` records how the row was last classified:
//   'resolved'   - ingredient_id is set and name is canonical (or the typed
//                  name was kept to preserve a qualifier)
//   'ambiguous'  - the name belongs to more than one catalog entry
//   'unresolved' - no catalog entry matched
//   NULL         - not evaluated yet (rows that predate this migration, or a
//                  save while the catalog was unavailable); the backfill
//                  (`scripts/backfillIngredientIds.ts`) classifies these.
// The FK is ON DELETE SET NULL because the deploy-time catalog sync deletes
// ingredients that leave the bundle; the next backfill re-resolves the row.
// The two indexes are built non-concurrently (a brief write lock): acceptable
// at current table sizes, and node-pg-migrate runs each migration in a
// transaction where CREATE INDEX CONCURRENTLY is not allowed.
// No RLS changes: both tables keep their existing household policies and
// table-level grants, which already cover new columns.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE recipe_ingredients
      ADD COLUMN ingredient_id TEXT REFERENCES ingredient_catalog(id) ON DELETE SET NULL,
      ADD COLUMN catalog_match TEXT
        CHECK (catalog_match IS NULL OR catalog_match IN ('resolved', 'ambiguous', 'unresolved'));

    ALTER TABLE pantry_items
      ADD COLUMN ingredient_id TEXT REFERENCES ingredient_catalog(id) ON DELETE SET NULL,
      ADD COLUMN catalog_match TEXT
        CHECK (catalog_match IS NULL OR catalog_match IN ('resolved', 'ambiguous', 'unresolved'));

    CREATE INDEX idx_recipe_ingredients_ingredient
      ON recipe_ingredients(ingredient_id) WHERE ingredient_id IS NOT NULL;
    CREATE INDEX idx_pantry_household_ingredient
      ON pantry_items(household_id, ingredient_id) WHERE ingredient_id IS NOT NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_pantry_household_ingredient;
    DROP INDEX IF EXISTS idx_recipe_ingredients_ingredient;
    ALTER TABLE pantry_items DROP COLUMN IF EXISTS catalog_match, DROP COLUMN IF EXISTS ingredient_id;
    ALTER TABLE recipe_ingredients DROP COLUMN IF EXISTS catalog_match, DROP COLUMN IF EXISTS ingredient_id;
  `);
}
