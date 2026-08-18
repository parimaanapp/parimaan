import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Written as raw SQL via `pgm.sql()` rather than the builder DSL: RLS
// policies and CHECK constraints don't have a clean high-level API in
// node-pg-migrate, and keeping the whole migration in one style keeps it a
// direct, auditable match against the DDL in SYSTEM_DESIGN.md §7.1.

const createUsersTable = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cognito_sub TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);
  `);
};

const createHouseholdsTable = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE households (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      primary_user_id UUID NOT NULL REFERENCES users(id),
      subscription_status TEXT NOT NULL DEFAULT 'free'
        CHECK (subscription_status IN ('free','trial','active','past_due','cancelled')),
      plan_id TEXT,
      stripe_customer_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_households_invite_code ON households(invite_code);
    CREATE INDEX idx_households_primary_user ON households(primary_user_id);
  `);
};

const createHouseholdSettingsTable = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE household_settings (
      household_id UUID PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
      meals_enabled JSONB NOT NULL DEFAULT '["breakfast","lunch","dinner"]',
      meal_structure JSONB NOT NULL DEFAULT '{"lunch":{"carb":1,"sabzi_dal":2,"accompaniment":1},"dinner":{"carb":1,"sabzi_dal":2,"accompaniment":1}}',
      cuisine_tier1 JSONB NOT NULL DEFAULT '["north_indian"]',
      cuisine_tier2_weights JSONB NOT NULL DEFAULT '{}',
      dietary_tags JSONB NOT NULL DEFAULT '[]',
      allergens JSONB NOT NULL DEFAULT '[]',
      skip_ingredients JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE household_settings ENABLE ROW LEVEL SECURITY;

    CREATE POLICY household_settings_member ON household_settings
      USING (
        household_id IN (
          SELECT household_id FROM household_memberships
          WHERE user_id = current_setting('parimaan.user_id')::UUID
        )
      );
  `);
};

const createHouseholdMembershipsTable = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    CREATE TABLE household_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('primary','member')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(household_id, user_id)
    );

    CREATE INDEX idx_memberships_user ON household_memberships(user_id);
    CREATE INDEX idx_memberships_household ON household_memberships(household_id);
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  createUsersTable(pgm);
  createHouseholdsTable(pgm);
  // household_memberships is created before household_settings even though
  // household_settings only FK-references households — its RLS policy's
  // subquery references household_memberships, and Postgres validates that
  // reference at CREATE POLICY time.
  createHouseholdMembershipsTable(pgm);
  createHouseholdSettingsTable(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Plain DROP TABLE (no CASCADE): the order below respects both the FK
  // dependency graph and the RLS policy dependency (household_settings'
  // policy references household_memberships, so it must be dropped first —
  // dropping household_memberships before it would fail on that reference).
  // Omitting CASCADE means a future migration's incomplete down() (leaving a
  // dependent object behind) fails loudly here instead of being silently
  // papered over.
  pgm.sql(`
    DROP TABLE IF EXISTS household_settings;
    DROP TABLE IF EXISTS household_memberships;
    DROP TABLE IF EXISTS households;
    DROP TABLE IF EXISTS users;
  `);
}
