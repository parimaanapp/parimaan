import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// W11 S2 (E2E_MVP_PLAN.md §17.3) — `generateShoppingList`/`regenerateShoppingList`'s
// `findShoppingListByMenu` (api/src/repositories/shoppingListRepository.ts)
// runs `WHERE generated_from_menu_id = $1 AND closed_at IS NULL` on every
// single call of both mutations, under the menu-scoped advisory lock — a
// genuine hot path. `1788200000000_shopping-lists.ts` (already shipped/
// applied, cannot be edited) only indexed `shopping_lists` on
// `(household_id) WHERE closed_at IS NULL` — there is no index at all on
// `generated_from_menu_id`, so this lookup seq-scans `shopping_lists` as it
// grows (database-reviewer finding, W11 S2). This is a pure `CREATE INDEX`
// addition, additive-only, matching the partial-index shape the prior
// migration already established for the identical "current open list"
// access pattern, just keyed on the menu instead of the household.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE INDEX idx_shopping_lists_menu_open ON shopping_lists(generated_from_menu_id)
      WHERE closed_at IS NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_shopping_lists_menu_open;
  `);
}
