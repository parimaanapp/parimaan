import type { PoolClient } from 'pg';

export interface ShoppingListRow {
  id: string;
  householdId: string;
  generatedFromMenuId: string | null;
  createdAt: Date;
  closedAt: Date | null;
  aiStaplesNote: string | null;
}

interface RawShoppingListRow {
  id: string;
  household_id: string;
  generated_from_menu_id: string | null;
  created_at: Date;
  closed_at: Date | null;
  ai_staples_note: string | null;
}

const mapShoppingListRow = (row: RawShoppingListRow): ShoppingListRow => ({
  id: row.id,
  householdId: row.household_id,
  generatedFromMenuId: row.generated_from_menu_id,
  createdAt: row.created_at,
  closedAt: row.closed_at,
  aiStaplesNote: row.ai_staples_note,
});

export interface ShoppingListItemRow {
  id: string;
  shoppingListId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  /** D8's origin marker (E2E_MVP_PLAN.md §17.2.8): non-null means auto-generated-from-a-recipe, null is reserved for a future manually-added item (`addShoppingListItem`, not built this week). */
  sourceRecipeId: string | null;
  purchased: boolean;
  purchasedBy: string | null;
  purchasedAt: Date | null;
  movedToPantry: boolean;
}

interface RawShoppingListItemRow {
  id: string;
  shopping_list_id: string;
  name: string;
  // NUMERIC comes back from `pg` as a string — same reasoning as
  // `pantryRepository.ts`'s/`recipeRepository.ts`'s own `quantity` columns.
  quantity: string | null;
  unit: string | null;
  category: string | null;
  source_recipe_id: string | null;
  purchased: boolean;
  purchased_by: string | null;
  purchased_at: Date | null;
  moved_to_pantry: boolean;
}

const mapShoppingListItemRow = (row: RawShoppingListItemRow): ShoppingListItemRow => ({
  id: row.id,
  shoppingListId: row.shopping_list_id,
  name: row.name,
  quantity: row.quantity === null ? null : Number(row.quantity),
  unit: row.unit,
  category: row.category,
  sourceRecipeId: row.source_recipe_id,
  purchased: row.purchased,
  purchasedBy: row.purchased_by,
  purchasedAt: row.purchased_at,
  movedToPantry: row.moved_to_pantry,
});

export interface NewShoppingListInput {
  householdId: string;
  generatedFromMenuId: string | null;
}

/**
 * Inserts a fresh `shopping_lists` parent row. Callers of this always
 * follow immediately with `insertShoppingListItems` for the same list, in
 * the same transaction (`generateShoppingList`/`regenerateShoppingList`'s
 * "no prior list" branch) — a failure on the items half rolls back this
 * insert too, matching `insertRecipe`'s own parent-then-children shape.
 */
export const insertShoppingList = async (
  client: PoolClient,
  input: NewShoppingListInput,
): Promise<ShoppingListRow> => {
  const result = await client.query<RawShoppingListRow>(
    `INSERT INTO shopping_lists (household_id, generated_from_menu_id)
     VALUES ($1, $2)
     RETURNING *`,
    [input.householdId, input.generatedFromMenuId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertShoppingList: expected a returned row.');
  }
  return mapShoppingListRow(row);
};

export interface NewShoppingListItemInput {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  sourceRecipeId: string;
}

/**
 * Batch-inserts every generated line in one round trip via a single
 * multi-row `INSERT ... VALUES`, parameterized per row (never string-
 * concatenated) — same injection-proofing convention as every other
 * repository in this codebase. Every row this function writes has a
 * non-null `sourceRecipeId` by construction (`NewShoppingListItemInput`'s
 * own type — this slice's generation pipeline always originates from a
 * recipe's ingredients, D8's origin marker), `purchased`/`movedToPantry`
 * default `FALSE` via the table's own `DEFAULT`. Called with an empty
 * `items` array only when a menu contributed zero non-staple ingredients
 * (S1's own "empty menu generates an empty list" case) — the caller is
 * expected to skip calling this entirely in that case (an empty `VALUES`
 * clause is invalid SQL), not to treat an empty array as a no-op here.
 */
export const insertShoppingListItems = async (
  client: PoolClient,
  shoppingListId: string,
  items: readonly NewShoppingListItemInput[],
): Promise<ShoppingListItemRow[]> => {
  if (items.length === 0) {
    return [];
  }

  const COLUMNS_PER_ROW = 6;
  const values: string[] = [];
  const params: unknown[] = [];
  items.forEach((item, index) => {
    const base = index * COLUMNS_PER_ROW;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(shoppingListId, item.name, item.quantity, item.unit, item.category, item.sourceRecipeId);
  });

  const result = await client.query<RawShoppingListItemRow>(
    `INSERT INTO shopping_list_items (shopping_list_id, name, quantity, unit, category, source_recipe_id)
     VALUES ${values.join(', ')}
     RETURNING *`,
    params,
  );
  return result.rows.map(mapShoppingListItemRow);
};

/**
 * The OPEN (`closed_at IS NULL`) shopping list generated from `menuId`, if
 * any — `regenerateShoppingList`'s lookup for D8's merge-regenerate design
 * (E2E_MVP_PLAN.md §17.2.8): a menu can accumulate at most one open list
 * across repeated `generateShoppingList`/`regenerateShoppingList` calls
 * under this slice's own guard (`generateShoppingList` refuses a second
 * call while one is still open). RLS on `shopping_lists` is what actually
 * scopes this to the caller's own household — no explicit `householdId`
 * parameter needed, same `id`-only-plus-RLS shape `findMenuById` uses. A
 * hot path — runs on every `generateShoppingList`/`regenerateShoppingList`
 * call, under `lockMenu`'s advisory lock — backed by
 * `idx_shopping_lists_menu_open` (`1788300000000_shopping-lists-menu-index.ts`,
 * added after `database-reviewer` flagged this query as seq-scanning
 * `shopping_lists` with no index on `generated_from_menu_id` at all).
 */
export const findShoppingListByMenu = async (
  client: PoolClient,
  menuId: string,
): Promise<ShoppingListRow | null> => {
  const result = await client.query<RawShoppingListRow>(
    `SELECT * FROM shopping_lists WHERE generated_from_menu_id = $1 AND closed_at IS NULL`,
    [menuId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapShoppingListRow(row);
};

/**
 * The OPEN (`closed_at IS NULL`) shopping list for a household, regardless
 * of which menu (if any) generated it — a broader lookup than
 * `findShoppingListByMenu`'s menu-scoped one, kept as its own function per
 * E2E_MVP_PLAN.md §17.3 S2's own file list (used by S3's `haveIt`, which
 * resolves a household from an `itemId` rather than a `menuId` and has no
 * menu to scope by).
 */
export const findOpenShoppingListForHousehold = async (
  client: PoolClient,
  householdId: string,
): Promise<ShoppingListRow | null> => {
  const result = await client.query<RawShoppingListRow>(
    `SELECT * FROM shopping_lists WHERE household_id = $1 AND closed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [householdId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapShoppingListRow(row);
};

/**
 * Every item on `shoppingListId`, in a stable category-then-name order —
 * there is no dedicated sort column on `shopping_list_items` (the migration
 * locks the DDL, E2E_MVP_PLAN.md §17.3 S1), so this is the closest
 * deterministic ordering available; `id` breaks any remaining tie so the
 * order never depends on physical row order. `category IS NULL` sorts last
 * (`NULLS LAST`) so "other"-bucketed items land at the end, matching
 * `domain/shoppingListGeneration.ts`'s own `categorize` convention of
 * treating `null` as the `"other"` bucket.
 */
export const findShoppingListItems = async (
  client: PoolClient,
  shoppingListId: string,
): Promise<ShoppingListItemRow[]> => {
  const result = await client.query<RawShoppingListItemRow>(
    `SELECT * FROM shopping_list_items
     WHERE shopping_list_id = $1
     ORDER BY category NULLS LAST, name, id`,
    [shoppingListId],
  );
  return result.rows.map(mapShoppingListItemRow);
};

/**
 * D8's own preserve/replace predicate (§17.2.8), as a pure function so the
 * resolver's `confirmed: false` preview path (which never runs the DELETE
 * below) and this repository's actual DELETE predicate can never drift
 * apart: an item is PRESERVED (never touched by regeneration) once it has
 * been marked had (`purchased`/`movedToPantry`) or was manually added
 * (`sourceRecipeId === null`, reserved for the not-yet-built
 * `addShoppingListItem`). Everything else — auto-generated, not yet had —
 * is replaceable.
 */
export const isPreservedShoppingListItem = (item: {
  purchased: boolean;
  movedToPantry: boolean;
  sourceRecipeId: string | null;
}): boolean => item.purchased || item.movedToPantry || item.sourceRecipeId === null;

/**
 * Deletes exactly the "replaceable" portion of `shoppingListId` — the
 * auto-generated (`source_recipe_id IS NOT NULL`), not-yet-had
 * (`purchased = FALSE AND moved_to_pantry = FALSE`) items — mirroring
 * {@link isPreservedShoppingListItem}'s negation in raw SQL. Every already-
 * had or manually-added row is left untouched by this statement, never
 * even written, which is what makes the "byte-identical row" RED test
 * (E2E_MVP_PLAN.md §17.3 S2) provable: those rows are never part of this
 * DELETE's `WHERE` clause at all.
 */
export const deleteReplaceableShoppingListItems = async (
  client: PoolClient,
  shoppingListId: string,
): Promise<void> => {
  await client.query(
    `DELETE FROM shopping_list_items
     WHERE shopping_list_id = $1
       AND source_recipe_id IS NOT NULL
       AND purchased = FALSE
       AND moved_to_pantry = FALSE`,
    [shoppingListId],
  );
};

/**
 * D8's merge-regenerate write (§17.2.8) for an EXISTING open list — deletes
 * only the replaceable portion (`deleteReplaceableShoppingListItems`) then
 * inserts `freshAutoItems` (S1's pipeline re-run against current menu/
 * pantry state), returning the full merged set (untouched preserved rows
 * plus the freshly-inserted ones). Callers run this inside their own
 * `withUserTransaction` scope — a failure partway through rolls back both
 * the delete and the insert together, never leaving the list half-replaced.
 */
export const mergeRegenerateShoppingList = async (
  client: PoolClient,
  shoppingListId: string,
  freshAutoItems: readonly NewShoppingListItemInput[],
): Promise<ShoppingListItemRow[]> => {
  await deleteReplaceableShoppingListItems(client, shoppingListId);
  if (freshAutoItems.length > 0) {
    await insertShoppingListItems(client, shoppingListId, freshAutoItems);
  }
  return findShoppingListItems(client, shoppingListId);
};
