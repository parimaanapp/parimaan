/**
 * FK-safe deletion order for the account wipe (E2E_MVP_PLAN.md §32.5).
 *
 * Children before parents, derived from `api/migrations` (the FK graph is
 * re-derived and asserted against this list in `steps.test.ts`, so adding a
 * table or FK without updating this file fails the suite).
 *
 * Parameters in every `where`: `$1` = uuid[] of households being deleted,
 * `$2` = uuid[] of users being deleted. The same predicate is used to list
 * the rows (dry run) and to delete them, inside the same transaction, so the
 * listing is exactly what gets deleted.
 *
 * Table names are constants here, never user input.
 */
export interface DeleteStep {
  readonly table: string;
  /** SQL expression yielding the row's identifying key as text. */
  readonly keyExpr: string;
  readonly where: string;
}

const RECIPES_OF_DELETED_HOUSEHOLDS = `SELECT id FROM public.recipes WHERE household_id = ANY($1::uuid[])`;

/** Migrations create everything in the default `public` schema; never rely on `search_path`. */
export const SCHEMA = 'public';

export const qualifiedTable = (step: DeleteStep): string => `${SCHEMA}.${step.table}`;

/**
 * Global reference tables (no household or user ownership): never wiped, and
 * so deliberately absent from `DELETE_STEPS`. Account data may later point at
 * them (e.g. an ingredient id), never the other way round.
 */
export const GLOBAL_REFERENCE_TABLES: readonly string[] = [
  'ingredient_catalog',
  'ingredient_aliases',
  'unit_conversions',
  'catalog_sync_state',
];

export const DELETE_STEPS: readonly DeleteStep[] = [
  {
    table: 'shopping_list_items',
    keyExpr: 'id::text',
    where: `shopping_list_id IN (SELECT id FROM public.shopping_lists WHERE household_id = ANY($1::uuid[]))`,
  },
  { table: 'shopping_lists', keyExpr: 'id::text', where: `household_id = ANY($1::uuid[])` },
  {
    table: 'menu_items',
    keyExpr: 'id::text',
    where: `menu_id IN (SELECT id FROM public.menus WHERE household_id = ANY($1::uuid[])) OR recipe_id IN (${RECIPES_OF_DELETED_HOUSEHOLDS})`,
  },
  { table: 'menus', keyExpr: 'id::text', where: `household_id = ANY($1::uuid[])` },
  {
    table: 'recipe_ingredients',
    keyExpr: 'id::text',
    where: `recipe_id IN (${RECIPES_OF_DELETED_HOUSEHOLDS})`,
  },
  { table: 'recipes', keyExpr: 'id::text', where: `household_id = ANY($1::uuid[])` },
  { table: 'pantry_items', keyExpr: 'id::text', where: `household_id = ANY($1::uuid[])` },
  {
    table: 'notification_preferences',
    keyExpr: `user_id::text || ':' || household_id::text`,
    where: `household_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`,
  },
  {
    table: 'household_memberships',
    keyExpr: 'id::text',
    where: `household_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`,
  },
  { table: 'household_settings', keyExpr: 'household_id::text', where: `household_id = ANY($1::uuid[])` },
  { table: 'households', keyExpr: 'id::text', where: `id = ANY($1::uuid[])` },
  { table: 'users', keyExpr: 'id::text', where: `id = ANY($2::uuid[])` },
];

/**
 * Postgres rejects a statement whose bound parameter is never referenced, and
 * most steps only use one of `$1`/`$2`. This always references both (a no-op
 * predicate) so every step can be run with the same two parameters.
 */
export const scopedWhere = (step: DeleteStep): string =>
  `(${step.where}) AND $1::uuid[] IS NOT NULL AND $2::uuid[] IS NOT NULL`;
