import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Raw SQL via `pgm.sql()`, matching the established pattern in
// 1787072268736_baseline-schema.ts, 1787124517648_app-role.ts,
// 1787670947641_pantry-items.ts, 1787808112003_recipes.ts, and
// 1788100000000_menus.ts: RLS policies, CHECK constraints, and GRANT don't
// have a clean high-level API in node-pg-migrate.

const APP_ROLE = 'parimaan_app';

const createShoppingListsTables = (pgm: MigrationBuilder): void => {
  // DDL matches SYSTEM_DESIGN.md §7.1 (lines 981-1008) exactly, re-read at
  // W11 planning time per E2E_MVP_PLAN.md §17's own instruction (that
  // section was updated during W11 planning for D1's `haveIt` return-type
  // widening and D9-carryover's `onMenuChanged` — neither changes this
  // DDL, both are SDL/resolver-only). `shopping_list_items.source_recipe_id`
  // doubles as D8's origin marker (§17.2.8): non-null means
  // auto-generated-from-a-recipe, null is reserved for a future
  // manually-added item (`addShoppingListItem`, not built this week) — no
  // separate boolean column, zero future migration cost when that ships.
  pgm.sql(`
    CREATE TABLE shopping_lists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      generated_from_menu_id UUID REFERENCES menus(id),
      ai_staples_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );

    -- Matches SD §7.1's own partial index exactly: the hot-path query is
    -- always "this household's currently-open list" (generate/regenerate/
    -- haveIt all look it up by household + open), and a household has at
    -- most a handful of closed historical lists that never need this index.
    CREATE INDEX idx_shopping_lists_household_open ON shopping_lists(household_id)
      WHERE closed_at IS NULL;

    CREATE TABLE shopping_list_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shopping_list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity NUMERIC,
      unit TEXT,
      category TEXT,
      source_recipe_id UUID REFERENCES recipes(id),
      purchased BOOLEAN NOT NULL DEFAULT FALSE,
      purchased_by UUID REFERENCES users(id),
      purchased_at TIMESTAMPTZ,
      moved_to_pantry BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE INDEX idx_shopping_list_items_list ON shopping_list_items(shopping_list_id);
  `);
};

const enableRls = (pgm: MigrationBuilder): void => {
  // `shopping_lists` gets the same membership-subquery policy shape as
  // `recipes`/`menus`: both `USING` and `WITH CHECK` explicit
  // (E2E_MVP_PLAN.md §11.2.2's lesson), `FORCE` not just `ENABLE`.
  pgm.sql(`
    ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopping_lists FORCE ROW LEVEL SECURITY;

    CREATE POLICY shopping_lists_household_member ON shopping_lists
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

  // `shopping_list_items` has no `household_id` of its own — the fourth
  // instance of this gap class after `recipe_ingredients` (W6),
  // `notification_preferences`'s per-user variant (W8), and `menu_items`
  // (W9). SD §7.1's own RLS block never listed it, so without this policy
  // a resolver bug that passes an unvalidated `itemId`/`listId` through
  // would leak another household's shopping-list items with zero
  // protection.
  //
  // Parent-join policy, same shape as `recipe_ingredients_via_recipe` and
  // `menu_items_via_menu`: `SELECT id FROM shopping_lists` is itself
  // RLS-filtered to the caller's households by the policy just above, so
  // this composes with it instead of hard-coding a second copy of the
  // membership rule.
  pgm.sql(`
    ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopping_list_items FORCE ROW LEVEL SECURITY;

    CREATE POLICY shopping_list_items_via_shopping_list ON shopping_list_items
      FOR ALL
      USING (shopping_list_id IN (SELECT id FROM shopping_lists))
      WITH CHECK (shopping_list_id IN (SELECT id FROM shopping_lists));
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON shopping_lists, shopping_list_items TO ${APP_ROLE};
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  createShoppingListsTables(pgm);
  enableRls(pgm);
  grantAppRole(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // No explicit REVOKE — GRANT is table-scoped, and DROP TABLE removes
  // the table's ACL entries (and its RLS policy) along with it.
  // `shopping_list_items` dropped first since it references
  // `shopping_lists` via FK.
  pgm.sql(`
    DROP TABLE IF EXISTS shopping_list_items;
    DROP TABLE IF EXISTS shopping_lists;
  `);
}
