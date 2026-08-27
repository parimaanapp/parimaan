import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Raw SQL via `pgm.sql()`, matching the established pattern in
// 1787072268736_baseline-schema.ts, 1787124517648_app-role.ts, and
// 1787670947641_pantry-items.ts: RLS policies, CHECK constraints, and
// GRANT don't have a clean high-level API in node-pg-migrate.

const APP_ROLE = 'parimaan_app';

const CUISINE_TIER1_VALUES = [
  'north_indian',
  'south_indian',
  'pan_indian',
  'other',
] as const;

const createRecipesTables = (pgm: MigrationBuilder): void => {
  // DDL matches SYSTEM_DESIGN.md §7.1 with two W6 deviations
  // (E2E_MVP_PLAN.md §12.2.6, §12.2.8), both `doc-updater` triggers:
  //   - `updated_at` added (SD §7.1 only had `created_at`) — without it
  //     there is no "did my edit land?" signal, and no staleness marker
  //     for a future recipes Drift cache (§12.2.12/§12.7 D7).
  //   - a `CHECK` on `cuisine_tier1` as a DB-level backstop. `role` is a
  //     closed GraphQL enum with the SD-specified CHECK already (`role`
  //     is non-null, so an invalid stored value is unreachable once this
  //     migration runs); `cuisine_tier1` and `dietary_tags` are also
  //     closed enums on the wire (`CuisineTier1`, `[DietaryTag!]!`) but
  //     had no DB constraint at all in the locked DDL — an unrecognised
  //     persisted value doesn't just corrupt one field, it makes AppSync
  //     fail to serialize the *entire* `Query.recipes` response (§12.2.6).
  //     `dietary_tags` stays unconstrained JSONB: the resolver-level
  //     rejection (`api/src/domain/dietaryTags.ts`, S2) is the enforcement
  //     point for a list-shaped field; a DB CHECK on JSONB array contents
  //     is disproportionate machinery for a defense-in-depth backstop here.
  pgm.sql(`
    CREATE TABLE recipes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('user','url','curated','ai','freeform_ai')),
      source_url TEXT,
      source_raw_text TEXT,
      title TEXT NOT NULL,
      description TEXT,
      servings INT NOT NULL DEFAULT 4,
      prep_min INT,
      cook_min INT,
      cuisine_tier1 TEXT CHECK (cuisine_tier1 IS NULL OR cuisine_tier1 IN (${CUISINE_TIER1_VALUES.map((v) => `'${v}'`).join(',')})),
      cuisine_tier2 TEXT,
      dietary_tags JSONB NOT NULL DEFAULT '[]',
      role TEXT NOT NULL CHECK (role IN ('breakfast','carb','sabzi_dal','accompaniment','snack','sweet','drink')),
      in_rotation BOOLEAN NOT NULL DEFAULT TRUE,
      is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      steps JSONB NOT NULL DEFAULT '[]',
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_recipes_household ON recipes(household_id);
    -- Partial index for W10's auto-fill (SD §5.4: "fetch recipes WHERE
    -- household_id=X AND in_rotation=true"), not W6's own Query.recipes
    -- (E2E_MVP_PLAN.md §12.2.14) — created now per the locked DDL, left
    -- unused until W10 deliberately, so a future reader doesn't "fix" it.
    CREATE INDEX idx_recipes_role ON recipes(household_id, role) WHERE in_rotation = TRUE;

    CREATE TABLE recipe_ingredients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity NUMERIC,
      unit TEXT,
      category TEXT,
      notes TEXT,
      is_staple BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INT NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
  `);
};

const enableRls = (pgm: MigrationBuilder): void => {
  // `recipes` gets the same membership-subquery policy shape as
  // `pantry_items` (1787670947641_pantry-items.ts) — both `USING` and
  // `WITH CHECK` explicit (E2E_MVP_PLAN.md §11.2.2's lesson: `USING` alone
  // governs SELECT/UPDATE/DELETE visibility but does nothing for INSERT),
  // `FORCE` not just `ENABLE` so the policy still applies if this table's
  // owner role is ever used to connect.
  pgm.sql(`
    ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE recipes FORCE ROW LEVEL SECURITY;

    CREATE POLICY recipes_household_member ON recipes
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

  // `recipe_ingredients` has no `household_id` column — it is the only
  // household-scoped child table in the schema without one
  // (E2E_MVP_PLAN.md §12.2.2) — and SD §7.1's RLS block never listed it at
  // all, so without this policy a resolver bug that passes an unvalidated
  // `recipeId` through would leak another household's ingredient list with
  // zero protection. Postgres RLS is per-table: a policy on `recipes` does
  // nothing for `SELECT * FROM recipe_ingredients WHERE recipe_id = $1`.
  //
  // The policy re-derives household membership through a parent join
  // rather than duplicating the membership subquery: `SELECT id FROM
  // recipes` is itself RLS-filtered to the caller's households by the
  // policy just above, so this composes with it instead of hard-coding a
  // second copy of the membership rule that could drift out of sync with
  // it later.
  pgm.sql(`
    ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE recipe_ingredients FORCE ROW LEVEL SECURITY;

    CREATE POLICY recipe_ingredients_via_recipe ON recipe_ingredients
      FOR ALL
      USING (recipe_id IN (SELECT id FROM recipes))
      WITH CHECK (recipe_id IN (SELECT id FROM recipes));
  `);
};

const grantAppRole = (pgm: MigrationBuilder): void => {
  // Kept in this new migration rather than added to the applied
  // `1787124517648_app-role.ts`'s `BASELINE_TABLES` list, same reasoning
  // as `1787670947641_pantry-items.ts`: that migration has already run in
  // every deployed environment, and there is no `ALTER DEFAULT PRIVILEGES`
  // in this schema, so `parimaan_app` has zero access to a new table until
  // explicitly granted (E2E_MVP_PLAN.md §11.2.3).
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON recipes, recipe_ingredients TO ${APP_ROLE};
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  createRecipesTables(pgm);
  enableRls(pgm);
  grantAppRole(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // No explicit REVOKE — same reasoning as pantry-items' down(): GRANT is
  // table-scoped, and DROP TABLE removes the table's ACL entries (and its
  // RLS policy) along with it. `recipe_ingredients` dropped first since it
  // references `recipes` via FK.
  pgm.sql(`
    DROP TABLE IF EXISTS recipe_ingredients;
    DROP TABLE IF EXISTS recipes;
  `);
}
