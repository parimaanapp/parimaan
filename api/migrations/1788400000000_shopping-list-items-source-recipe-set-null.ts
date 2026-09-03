import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * W11 S4's real-AWS verification pass (E2E_MVP_PLAN.md §17.8, "A regression
 * found while cleaning up") found that `shopping_list_items.source_recipe_id`
 * (`1788200000000_shopping-lists.ts`) was created with no `ON DELETE`
 * action, which defaults to `NO ACTION`. `shopping_lists.household_id` and
 * `shopping_list_items.shopping_list_id` both cascade, but this one FK
 * doesn't, so deleting a recipe — directly via `deleteRecipe`, or
 * transitively via `deleteHousehold`'s cascade from `households` through
 * `recipes` (`recipes.household_id ... ON DELETE CASCADE`,
 * `1787808112003_recipes.ts`) — hits a `23503` foreign-key violation the
 * moment that recipe has ever sourced a generated shopping-list item, rolls
 * the whole transaction back, and surfaces only a generic masked error to
 * the caller. Net effect: any household that has ever generated a shopping
 * list becomes permanently undeletable, and so does any recipe referenced
 * by a generated item on it (bought or not — `source_recipe_id` is set at
 * generation time regardless of purchase status).
 *
 * Founder-confirmed fix: `ON DELETE SET NULL`. Every shopping-list item —
 * purchased, moved to pantry, or still open — is preserved; only its recipe
 * attribution is cleared when the source recipe (or the household that
 * owned it) is deleted. This matches D8's own origin-marker semantics
 * (`source_recipe_id IS NOT NULL` means "auto-generated from a recipe");
 * once the recipe is gone that marker correctly reverts to "no known
 * recipe origin," identical in shape to a manually-added item.
 *
 * `source_recipe_id` has no `NOT NULL` constraint (it's already nullable —
 * that's D8's own manually-added-item case), so `SET NULL` is a legal
 * target with no companion column change needed.
 *
 * Postgres has no `ALTER CONSTRAINT` for changing a foreign key's `ON
 * DELETE` action — drop and recreate is the only path, same DROP-then-
 * CREATE shape `1788000000000_household-settings-with-check.ts` used for
 * its policy change. The constraint name here is the one Postgres itself
 * generated for the original inline `REFERENCES` clause
 * (`table_column_fkey`), confirmed against the CloudWatch FK-violation
 * error text E2E_MVP_PLAN.md §17.8 quotes verbatim:
 * `"shopping_list_items_source_recipe_id_fkey"`.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE shopping_list_items
      DROP CONSTRAINT shopping_list_items_source_recipe_id_fkey,
      ADD CONSTRAINT shopping_list_items_source_recipe_id_fkey
        FOREIGN KEY (source_recipe_id) REFERENCES recipes(id) ON DELETE SET NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Restores the exact pre-migration shape (no ON DELETE action, i.e.
  // NO ACTION) — a down() that left SET NULL in place would not actually
  // be reversing this migration.
  pgm.sql(`
    ALTER TABLE shopping_list_items
      DROP CONSTRAINT shopping_list_items_source_recipe_id_fkey,
      ADD CONSTRAINT shopping_list_items_source_recipe_id_fkey
        FOREIGN KEY (source_recipe_id) REFERENCES recipes(id);
  `);
}
