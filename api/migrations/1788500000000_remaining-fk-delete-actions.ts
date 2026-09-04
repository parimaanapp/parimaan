import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * A code-review pass on `fix/w11-shopping-list-fk-delete` (PR #108, which
 * fixed `shopping_list_items.source_recipe_id`'s missing `ON DELETE`
 * action — `1788400000000_shopping-list-items-source-recipe-set-null.ts`)
 * found five more foreign keys across the schema with the identical shape:
 * created with a bare `REFERENCES` and no `ON DELETE` clause, which
 * Postgres defaults to `NO ACTION`. None of these are exercised by any
 * resolver today — there is no `deleteUser` or `deleteMenu` yet — so they
 * are currently latent, not actively broken. But the exact bug PR #108 hit
 * (a masked `23503` foreign-key violation rolling back an unrelated delete
 * the moment a referencing row exists) will resurface the instant
 * user- or menu-deletion is implemented, unless each of these gets a
 * deliberate `ON DELETE` decision now, while the fix is cheap and isolated.
 *
 * Batched into one migration file (rather than PR #108's one-fix-per-file
 * precedent) because all five are the same bug class, from the same review
 * pass, with no interdependency risk between them — closer in shape to
 * `1787072268736_baseline-schema.ts` batching multiple related table
 * creates in one migration than to a series of unrelated point fixes. Each
 * gets its own named helper function below, so the `up()`/`down()` bodies
 * read as a manifest of exactly which five constraints this migration
 * touches.
 *
 * Four of the five are "who did this" attribution/audit columns:
 * `households.primary_user_id`, `pantry_items.added_by`,
 * `recipes.created_by`, `shopping_list_items.purchased_by`. All four get
 * `ON DELETE SET NULL` — the same reasoning as PR #108's own fix: preserve
 * the row itself (a household, a pantry item, a recipe, a purchase record
 * on a shopping-list item), drop only the now-dangling attribution to a
 * user who no longer exists.
 *
 * Unlike PR #108's `source_recipe_id` (already nullable, no companion
 * change needed), three of these four were created `NOT NULL`:
 * `households.primary_user_id`, `pantry_items.added_by`, and
 * `recipes.created_by` (`shopping_list_items.purchased_by` is the one
 * already nullable). `ON DELETE SET NULL` on a `NOT NULL` column is not a
 * silent no-op — Postgres accepts the constraint definition itself, but
 * the moment a delete actually tries to null the column, the `NOT NULL`
 * check fires and the delete fails with `23502`, i.e. the exact same
 * "referenced row is now undeletable" failure mode this migration exists
 * to fix, just a different error code. So each of these three also drops
 * its `NOT NULL` constraint here, as a required companion change, not an
 * optional cleanup — `SET NULL` is only a legal, working target once the
 * column can actually hold NULL.
 *
 * KNOWN FORWARD GAP, left for whoever implements `deleteUser`: the GraphQL
 * schema (`shared/schema.graphql`) still declares `Household.primaryUserId`
 * and `PantryItem.addedBy` as non-null (`ID!`) — `Recipe.createdBy` isn't
 * exposed over GraphQL at all, and `ShoppingListItem.purchasedBy` was
 * already nullable (`ID`) before this migration. The DB-level change here
 * is correct and sufficient on its own (this migration's job), but it
 * creates a DB/GraphQL nullability mismatch that stays latent — same as
 * the FK itself — until `deleteUser` actually nulls one of these columns
 * for the first time; at that point AppSync will fail to serialize the
 * whole `Household`/`PantryItem` response, the same failure class this
 * schema has already hit twice for non-null enum fields
 * (`recipes.cuisine_tier1`, `menus.slot_role` — both fixed with a CHECK,
 * a different kind of non-null mismatch, but the AppSync failure mode is
 * identical). Widening those two GraphQL fields to nullable is
 * `deleteUser`'s job, not this migration's — flagged here so it isn't
 * missed.
 *
 * The fifth, `shopping_lists.generated_from_menu_id`, is the opposite
 * choice — `ON DELETE CASCADE` — deliberately, not by habit-matching the
 * other four. A shopping list only exists because a menu was generated
 * into it; unlike a user attribution field, there is no meaningful
 * "shopping list with an unknown origin menu" state worth preserving — a
 * shopping list's entire reason for being is that specific menu's planned
 * meals. If the menu is gone, the list it produced should go with it. This
 * mirrors `shopping_lists.household_id ... ON DELETE CASCADE`
 * (`1788200000000_shopping-lists.ts`), which already cascades the same
 * table on its other FK for the same "this row has no independent
 * existence apart from its parent" reasoning — `generated_from_menu_id`
 * just extends that to the row's other parent. This column is nullable
 * too (SD's DDL never marked it `NOT NULL`, since a manually-created
 * shopping list unattached to a menu is a valid future state — not built
 * this week), but `SET NULL` was rejected here: an orphaned shopping list
 * still full of items no menu asked for is confusing leftover state, not
 * a record worth keeping around once its source menu is gone.
 *
 * Postgres has no `ALTER CONSTRAINT` for changing a foreign key's
 * `ON DELETE` action — drop and recreate is the only path, same
 * DROP-then-ADD shape `1788000000000_household-settings-with-check.ts`
 * and `1788400000000_shopping-list-items-source-recipe-set-null.ts` both
 * used for the same kind of in-place constraint change. Every constraint
 * name below is the one Postgres itself generated for the original inline
 * `REFERENCES` clause (`table_column_fkey`), confirmed against each
 * column's originating `CREATE TABLE` in the migrations named in each
 * helper's comment.
 *
 * `ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID`, followed by a separate
 * `VALIDATE CONSTRAINT` (database-reviewer finding on this migration):
 * a plain `ADD CONSTRAINT` re-validates the new FK against every existing
 * row under the same statement's `ACCESS EXCLUSIVE` lock, blocking all
 * reads and writes on the table for the scan's full duration. That
 * validation is pure overhead here — the FK was already enforced pre-drop
 * (only its `ON DELETE` action changes), so every existing row is
 * guaranteed to already satisfy it — but the lock cost is real on a table
 * with production rows. `NOT VALID` registers the constraint under a brief
 * `ACCESS EXCLUSIVE` lock with no scan; the following `VALIDATE CONSTRAINT`
 * only needs `SHARE UPDATE EXCLUSIVE`, which permits concurrent reads and
 * writes. Immaterial at this week's data volume, but adopted here as the
 * pattern this file's own lineage (future FK-recreation migrations) should
 * copy rather than the single-statement form.
 */

// households.primary_user_id — 1787072268736_baseline-schema.ts. Was
// `NOT NULL`; dropped here as a required companion to `SET NULL` (see
// module comment above) — without it, deleting the referenced user still
// fails, just with `23502` instead of `23503`.
const fixHouseholdsPrimaryUser = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE households
      ALTER COLUMN primary_user_id DROP NOT NULL,
      DROP CONSTRAINT households_primary_user_id_fkey,
      ADD CONSTRAINT households_primary_user_id_fkey
        FOREIGN KEY (primary_user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;

    ALTER TABLE households VALIDATE CONSTRAINT households_primary_user_id_fkey;
  `);
};

// pantry_items.added_by — 1787670947641_pantry-items.ts. Was `NOT NULL`;
// same required companion drop as households.primary_user_id above.
const fixPantryItemsAddedBy = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE pantry_items
      ALTER COLUMN added_by DROP NOT NULL,
      DROP CONSTRAINT pantry_items_added_by_fkey,
      ADD CONSTRAINT pantry_items_added_by_fkey
        FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL NOT VALID;

    ALTER TABLE pantry_items VALIDATE CONSTRAINT pantry_items_added_by_fkey;
  `);
};

// recipes.created_by — 1787808112003_recipes.ts. Was `NOT NULL`; same
// required companion drop as households.primary_user_id above.
const fixRecipesCreatedBy = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE recipes
      ALTER COLUMN created_by DROP NOT NULL,
      DROP CONSTRAINT recipes_created_by_fkey,
      ADD CONSTRAINT recipes_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL NOT VALID;

    ALTER TABLE recipes VALIDATE CONSTRAINT recipes_created_by_fkey;
  `);
};

// shopping_lists.generated_from_menu_id — 1788200000000_shopping-lists.ts
// The one CASCADE among the five — see the module comment above for why.
const fixShoppingListsGeneratedFromMenu = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE shopping_lists
      DROP CONSTRAINT shopping_lists_generated_from_menu_id_fkey,
      ADD CONSTRAINT shopping_lists_generated_from_menu_id_fkey
        FOREIGN KEY (generated_from_menu_id) REFERENCES menus(id) ON DELETE CASCADE NOT VALID;

    ALTER TABLE shopping_lists VALIDATE CONSTRAINT shopping_lists_generated_from_menu_id_fkey;
  `);
};

// shopping_list_items.purchased_by — 1788200000000_shopping-lists.ts
const fixShoppingListItemsPurchasedBy = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    ALTER TABLE shopping_list_items
      DROP CONSTRAINT shopping_list_items_purchased_by_fkey,
      ADD CONSTRAINT shopping_list_items_purchased_by_fkey
        FOREIGN KEY (purchased_by) REFERENCES users(id) ON DELETE SET NULL NOT VALID;

    ALTER TABLE shopping_list_items VALIDATE CONSTRAINT shopping_list_items_purchased_by_fkey;
  `);
};

export async function up(pgm: MigrationBuilder): Promise<void> {
  fixHouseholdsPrimaryUser(pgm);
  fixPantryItemsAddedBy(pgm);
  fixRecipesCreatedBy(pgm);
  fixShoppingListsGeneratedFromMenu(pgm);
  fixShoppingListItemsPurchasedBy(pgm);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Restores the exact pre-migration shape (no ON DELETE action, i.e.
  // NO ACTION, and NOT NULL restored on the three columns that had it) for
  // all five — a down() that left any of these changed would not actually
  // be reversing this migration. Order doesn't matter here (no cross-table
  // dependency between these five ALTERs), so this just mirrors up()'s
  // order for readability.
  //
  // Restoring `SET NOT NULL` here assumes no row has actually been
  // nulled out by the up()-side `ON DELETE SET NULL` yet (true for any
  // environment where this migration is reversed shortly after applying,
  // before a user/menu delete has exercised it) — the same standing
  // assumption every `down()` in this schema makes about reversing before
  // data has diverged from the pre-migration shape. If a NULL has already
  // been written, this `down()` fails loudly with a NOT NULL violation
  // rather than silently dropping data, which is the correct failure mode.
  pgm.sql(`
    ALTER TABLE households
      DROP CONSTRAINT households_primary_user_id_fkey,
      ADD CONSTRAINT households_primary_user_id_fkey
        FOREIGN KEY (primary_user_id) REFERENCES users(id),
      ALTER COLUMN primary_user_id SET NOT NULL;

    ALTER TABLE pantry_items
      DROP CONSTRAINT pantry_items_added_by_fkey,
      ADD CONSTRAINT pantry_items_added_by_fkey
        FOREIGN KEY (added_by) REFERENCES users(id),
      ALTER COLUMN added_by SET NOT NULL;

    ALTER TABLE recipes
      DROP CONSTRAINT recipes_created_by_fkey,
      ADD CONSTRAINT recipes_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id),
      ALTER COLUMN created_by SET NOT NULL;

    ALTER TABLE shopping_lists
      DROP CONSTRAINT shopping_lists_generated_from_menu_id_fkey,
      ADD CONSTRAINT shopping_lists_generated_from_menu_id_fkey
        FOREIGN KEY (generated_from_menu_id) REFERENCES menus(id);

    ALTER TABLE shopping_list_items
      DROP CONSTRAINT shopping_list_items_purchased_by_fkey,
      ADD CONSTRAINT shopping_list_items_purchased_by_fkey
        FOREIGN KEY (purchased_by) REFERENCES users(id);
  `);
}
