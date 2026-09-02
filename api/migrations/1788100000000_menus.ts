import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Raw SQL via `pgm.sql()`, matching the established pattern in
// 1787072268736_baseline-schema.ts, 1787124517648_app-role.ts,
// 1787670947641_pantry-items.ts, and 1787808112003_recipes.ts: RLS
// policies, CHECK constraints, and GRANT don't have a clean high-level
// API in node-pg-migrate.

const APP_ROLE = 'parimaan_app';

const ROLE_VALUES = [
  'breakfast',
  'carb',
  'sabzi_dal',
  'accompaniment',
  'snack',
  'sweet',
  'drink',
] as const;

const MEAL_TYPE_VALUES = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;

const createMenusTables = (pgm: MigrationBuilder): void => {
  // DDL matches SYSTEM_DESIGN.md §7.1 (lines 894-906) with one W9
  // deviation (E2E_MVP_PLAN.md §15.2.1, a `doc-updater` trigger): a CHECK
  // on `slot_role` matching `RecipeRole`'s seven values, the same fix
  // `1787811731724_fix-recipes-cuisine-tier1-check.ts` already applied
  // once to `recipes.cuisine_tier1` — SD's own DDL text left this column
  // as bare TEXT with no constraint, and an unrecognised value here would
  // break `Query.menu`'s entire response the same way an unrecognised
  // `cuisine_tier1` did there (AppSync fails to serialize a non-nullable
  // enum field for the whole list, not just the one bad row).
  pgm.sql(`
    CREATE TABLE menus (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      week_start_date DATE NOT NULL,
      UNIQUE(household_id, week_start_date)
    );

    -- No separate index on household_id alone: the UNIQUE(household_id,
    -- week_start_date) constraint above already creates a composite btree
    -- index with household_id as its leading column, which Postgres can
    -- use for a plain WHERE household_id = $1 via that index's leftmost
    -- prefix. A second single-column index would be redundant -- extra
    -- write/maintenance cost with no query-planning benefit, since every
    -- query in this slice (S2/S3) filters on household_id and
    -- week_start_date together anyway.

    CREATE TABLE menu_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      menu_id UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      meal_slot TEXT NOT NULL CHECK (meal_slot IN (${MEAL_TYPE_VALUES.map((v) => `'${v}'`).join(',')})),
      slot_role TEXT NOT NULL CHECK (slot_role IN (${ROLE_VALUES.map((v) => `'${v}'`).join(',')})),
      servings_override INT,
      made_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_menu_items_menu ON menu_items(menu_id);
    CREATE INDEX idx_menu_items_recipe_recency ON menu_items(recipe_id, created_at DESC);
  `);
};

const enableRls = (pgm: MigrationBuilder): void => {
  // `menus` gets the same membership-subquery policy shape as `recipes`
  // (1787808112003_recipes.ts) — both `USING` and `WITH CHECK` explicit
  // (E2E_MVP_PLAN.md §11.2.2's lesson, re-confirmed empirically at §14.5.9:
  // explicit on both sides is still correct practice even though a bare
  // `FOR ALL USING (...)` would implicitly reuse it), `FORCE` not just
  // `ENABLE`.
  pgm.sql(`
    ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
    ALTER TABLE menus FORCE ROW LEVEL SECURITY;

    CREATE POLICY menus_household_member ON menus
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

  // `menu_items` has no `household_id` of its own — the third instance of
  // this gap class after `recipe_ingredients` (W6, §12.2.2) and
  // `notification_preferences`'s per-user variant (W8, §14.2.7) —
  // E2E_MVP_PLAN.md §15.2.2. SD §7.1's own RLS block never listed it, so
  // without this policy a resolver bug that passes an unvalidated
  // `menuId` through would leak another household's menu items with zero
  // protection. `Query.menu`'s `MenuItem.recipe`/list resolution has no
  // `householdId` to gate on, so this is the sole authorization for this
  // table, not defense-in-depth.
  //
  // The policy re-derives household membership through the `menus` parent
  // join rather than duplicating the membership subquery, same reasoning
  // `recipe_ingredients_via_recipe` uses: `SELECT id FROM menus` is
  // itself RLS-filtered to the caller's households by the policy just
  // above, so this composes with it instead of hard-coding a second copy
  // of the membership rule that could drift out of sync with it later.
  pgm.sql(`
    ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE menu_items FORCE ROW LEVEL SECURITY;

    CREATE POLICY menu_items_via_menu ON menu_items
      FOR ALL
      USING (menu_id IN (SELECT id FROM menus))
      WITH CHECK (menu_id IN (SELECT id FROM menus));
  `);
};

const grantAppRole = (pgm: MigrationBuilder): void => {
  // Kept in this new migration rather than the applied
  // `1787124517648_app-role.ts`'s `BASELINE_TABLES` list, same reasoning
  // as every prior new-table migration: that migration has already run in
  // every deployed environment, and there is no `ALTER DEFAULT
  // PRIVILEGES` in this schema, so `parimaan_app` has zero access to a new
  // table until explicitly granted (E2E_MVP_PLAN.md §11.2.3).
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON menus, menu_items TO ${APP_ROLE};
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  createMenusTables(pgm);
  enableRls(pgm);
  grantAppRole(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // No explicit REVOKE — GRANT is table-scoped, and DROP TABLE removes
  // the table's ACL entries (and its RLS policy) along with it.
  // `menu_items` dropped first since it references `menus` via FK.
  pgm.sql(`
    DROP TABLE IF EXISTS menu_items;
    DROP TABLE IF EXISTS menus;
  `);
}
