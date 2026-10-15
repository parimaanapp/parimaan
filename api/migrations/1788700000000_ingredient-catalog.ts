import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Raw SQL via `pgm.sql()`, same convention as the other migrations.
//
// Global, read-only reference data (E2E_MVP_PLAN.md §32.2 B1/B2): the
// ingredient catalog, its aliases and the unit-conversion table. These tables
// have no household scope, so there is deliberately no RLS: every
// authenticated user may read the same rows, and `parimaan_app` gets SELECT
// only. Rows are written by the deploy-time catalog sync (`syncCatalog`, run
// by the migration-runner Lambda as the admin role) from the bundled JSON.
//
// `ingredient_aliases` is keyed (alias_key, ingredient_id) rather than by
// alias_key alone: the signed-off catalog has aliases that legitimately name
// two products (e.g. "magaz", "lasun") and the resolver must see both to
// report an ambiguity instead of silently dropping one.

const APP_ROLE = 'parimaan_app';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE ingredient_catalog (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL UNIQUE,
      app_category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      allowed_units TEXT[] NOT NULL CHECK (cardinality(allowed_units) > 0),
      default_unit TEXT NOT NULL,
      piece_g NUMERIC CHECK (piece_g IS NULL OR piece_g > 0),
      cup_g NUMERIC CHECK (cup_g IS NULL OR cup_g > 0),
      note TEXT NOT NULL DEFAULT '',
      CONSTRAINT ingredient_catalog_default_unit_allowed CHECK (default_unit = ANY (allowed_units))
    );

    CREATE INDEX idx_ingredient_catalog_category ON ingredient_catalog(app_category);

    CREATE TABLE ingredient_aliases (
      alias_key TEXT NOT NULL,
      ingredient_id TEXT NOT NULL REFERENCES ingredient_catalog(id) ON DELETE CASCADE,
      alias_display TEXT NOT NULL,
      PRIMARY KEY (alias_key, ingredient_id)
    );

    CREATE INDEX idx_ingredient_aliases_ingredient ON ingredient_aliases(ingredient_id);

    CREATE TABLE unit_conversions (
      scope TEXT NOT NULL CHECK (scope IN ('subcategory', 'ingredient')),
      key TEXT NOT NULL,
      unit TEXT NOT NULL,
      base_unit TEXT NOT NULL,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      PRIMARY KEY (scope, key, unit)
    );

    -- Bookkeeping for the deploy-time sync only (single row). Not granted to
    -- the app role.
    CREATE TABLE catalog_sync_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      content_hash TEXT NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    GRANT SELECT ON ingredient_catalog, ingredient_aliases, unit_conversions TO ${APP_ROLE};
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    REVOKE SELECT ON ingredient_catalog, ingredient_aliases, unit_conversions FROM ${APP_ROLE};
    DROP TABLE IF EXISTS catalog_sync_state;
    DROP TABLE IF EXISTS unit_conversions;
    DROP TABLE IF EXISTS ingredient_aliases;
    DROP TABLE IF EXISTS ingredient_catalog;
  `);
}
