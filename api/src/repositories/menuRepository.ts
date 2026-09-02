import type { PoolClient } from 'pg';
import { toAwsDateString } from '../domain/pgDate.js';
import type { RecipeRow } from './recipeRepository.js';
import { findRecipesByIds } from './recipeRepository.js';

export interface MenuRow {
  id: string;
  householdId: string;
  /** A plain calendar date — see `validation/menu.ts`'s own comment on why the wire type is `AWSDateTime` despite this. */
  weekStartDate: string;
}

interface RawMenuRow {
  id: string;
  household_id: string;
  week_start_date: Date;
}

const mapMenuRow = (row: RawMenuRow): MenuRow => ({
  id: row.id,
  householdId: row.household_id,
  weekStartDate: toAwsDateString(row.week_start_date),
});

/**
 * Creates a household's menu for `weekStartDate`, or returns the existing
 * one if a menu for that exact week already exists (E2E_MVP_PLAN.md §15.3
 * S2) — idempotent by construction via `menus`' own
 * `UNIQUE(household_id, week_start_date)` constraint, matching
 * `joinHousehold`'s own idempotent-re-join precedent rather than
 * `createHousehold`'s create-only one: opening the Weekly plan screen for
 * a week with no menu yet is the expected first-visit path, not an edge
 * case to reject. `DO UPDATE SET household_id = EXCLUDED.household_id` is
 * a deliberate no-op write (not `DO NOTHING`) — `ON CONFLICT DO NOTHING`
 * has no `RETURNING` row on the conflicting branch, and this call always
 * needs the (possibly pre-existing) row back.
 */
export const createMenu = async (
  client: PoolClient,
  householdId: string,
  weekStartDate: string,
): Promise<MenuRow> => {
  const result = await client.query<RawMenuRow>(
    `INSERT INTO menus (household_id, week_start_date)
     VALUES ($1, $2)
     ON CONFLICT (household_id, week_start_date) DO UPDATE SET household_id = EXCLUDED.household_id
     RETURNING *`,
    [householdId, weekStartDate],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('createMenu: expected a returned row.');
  }
  return mapMenuRow(row);
};

/** `null`, not a thrown error, if no menu exists yet for that week — a pure read, never an implicit create (E2E_MVP_PLAN.md §15.2.5). */
export const findMenuByWeek = async (
  client: PoolClient,
  householdId: string,
  weekStartDate: string,
): Promise<MenuRow | null> => {
  const result = await client.query<RawMenuRow>(
    `SELECT * FROM menus WHERE household_id = $1 AND week_start_date = $2`,
    [householdId, weekStartDate],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapMenuRow(row);
};

/**
 * Looks up a menu by id with no `householdId` to check against — `addMenuItem`
 * only takes `menuId` (SD §6.1's locked signature), so this is `addMenuItem`/
 * `removeMenuItem`'s way of resolving *which* household to run
 * `requireHouseholdMember` against. RLS is the actual authorization here: a
 * caller who isn't a member of this menu's household gets `null`, identical
 * to a genuinely nonexistent id — see `resolvers/addMenuItem.ts`'s own
 * comment for how that collapses into one denial.
 */
export const findMenuById = async (client: PoolClient, id: string): Promise<MenuRow | null> => {
  const result = await client.query<RawMenuRow>(`SELECT * FROM menus WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row === undefined ? null : mapMenuRow(row);
};

/**
 * Serializes concurrent `addMenuItem` calls for the same slot within this
 * transaction — a transaction-scoped advisory lock (auto-released at
 * COMMIT/ROLLBACK, `pg_advisory_xact_lock`, never needs an explicit unlock)
 * keyed on the exact `(menuId, dayOfWeek, mealSlot, slotRole)` grouping
 * `countMenuItemsInSlot` counts against. Without this, two concurrent
 * `addMenuItem` calls for a slot sitting at `cap - 1` could both read the
 * same pre-insert count, both pass the cap check, and both commit —
 * overshooting the configured cap with no DB constraint to catch it
 * (`menu_items` only has per-column `CHECK`s, no count-bounding constraint).
 * Call this BEFORE `countMenuItemsInSlot`, with the identical `slotRole`
 * value (including `null` for the single-item breakfast/snacks case) so the
 * lock and the count agree on what "the same slot" means.
 * `hashtextextended` collapses the composite key to the `bigint`
 * `pg_advisory_xact_lock` takes; a hash collision would only ever make the
 * lock overly conservative (two different slots briefly serializing against
 * each other), never under-lock, so it's safe even though it's not
 * collision-proof.
 */
export const lockMenuSlot = async (
  client: PoolClient,
  menuId: string,
  dayOfWeek: number,
  mealSlot: string,
  slotRole: string | null,
): Promise<void> => {
  const key = `${menuId}:${dayOfWeek}:${mealSlot}:${slotRole ?? ''}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
};

/**
 * The number of `menu_items` already occupying `(menuId, dayOfWeek,
 * mealSlot)` — `slotRole: null` counts every item in that slot regardless of
 * role (breakfast/snacks' flat single-item cap, `domain/mealStructure.ts`),
 * a non-null `slotRole` counts only that role (lunch/dinner's per-role cap).
 */
export const countMenuItemsInSlot = async (
  client: PoolClient,
  menuId: string,
  dayOfWeek: number,
  mealSlot: string,
  slotRole: string | null,
): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM menu_items
     WHERE menu_id = $1 AND day_of_week = $2 AND meal_slot = $3
       AND ($4::text IS NULL OR slot_role = $4)`,
    [menuId, dayOfWeek, mealSlot, slotRole],
  );
  return Number(result.rows[0]?.count ?? 0);
};

export interface NewMenuItemInput {
  menuId: string;
  recipeId: string;
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
  servingsOverride: number | null;
}

export interface NewMenuItemRow {
  id: string;
  menuId: string;
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
  servingsOverride: number | null;
  madeAt: Date | null;
}

/**
 * Returns the bare inserted row, without a hydrated `recipe` — unlike
 * `findMenuItems`, `addMenuItem`'s own resolver already has the full
 * `RecipeRow` in hand (it fetched it to run the cross-household ownership
 * check before calling this), so re-fetching it here would be a wasted
 * round trip.
 */
export const insertMenuItem = async (
  client: PoolClient,
  input: NewMenuItemInput,
): Promise<NewMenuItemRow> => {
  const result = await client.query<RawMenuItemRow>(
    `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role, servings_override)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.menuId, input.recipeId, input.dayOfWeek, input.mealSlot, input.slotRole, input.servingsOverride],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertMenuItem: expected a returned row.');
  }
  return {
    id: row.id,
    menuId: row.menu_id,
    dayOfWeek: row.day_of_week,
    mealSlot: row.meal_slot,
    slotRole: row.slot_role,
    servingsOverride: row.servings_override,
    madeAt: row.made_at,
  };
};

/**
 * Joins through to `menus` to resolve the household a `menu_items` row
 * belongs to, for `removeMenuItem`'s explicit `requireHouseholdMember`
 * check — both tables' own RLS policies apply to this query, so a
 * non-member gets `null` for a real id in another household, identical to a
 * genuinely nonexistent one.
 */
export const findMenuItemHousehold = async (
  client: PoolClient,
  id: string,
): Promise<{ id: string; householdId: string } | null> => {
  const result = await client.query<{ id: string; household_id: string }>(
    `SELECT mi.id, m.household_id
     FROM menu_items mi
     JOIN menus m ON m.id = mi.menu_id
     WHERE mi.id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, householdId: row.household_id };
};

/**
 * Idempotent by return value, not by query shape: a `DELETE` for an
 * already-removed (or never-existed) id simply matches zero rows, which
 * this reports as `false` rather than throwing — matching `removeMenuItem`'s
 * locked `Boolean!` semantics (E2E_MVP_PLAN.md §15.3 S3).
 */
export const deleteMenuItemById = async (client: PoolClient, id: string): Promise<boolean> => {
  const result = await client.query(`DELETE FROM menu_items WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
};

export interface MenuItemRow {
  id: string;
  menuId: string;
  recipe: RecipeRow;
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
  servingsOverride: number | null;
  madeAt: Date | null;
}

interface RawMenuItemRow {
  id: string;
  menu_id: string;
  recipe_id: string;
  day_of_week: number;
  meal_slot: string;
  slot_role: string;
  servings_override: number | null;
  made_at: Date | null;
}

/**
 * Reads every item on `menuId`, each hydrated with its full `Recipe`.
 * `MenuItem.recipe` is a required, non-null nested object (unlike
 * `Recipe.ingredients`, which is a separate field resolver, W6 D5) —
 * hydrated here via a batch `findRecipesByIds` call (one extra round trip
 * for the whole list, not one per item) rather than embedding a hand-
 * written JOIN that would duplicate `recipeRepository.ts`'s own row shape
 * and mapping and drift out of sync with it. A `menu_items` row whose
 * `recipe_id` didn't come back from the batch fetch (should not happen —
 * the FK guarantees the recipe exists, and RLS is symmetric for a
 * `menu_items`/`recipes` pair in the same household — but not provably
 * unreachable under READ COMMITTED) is dropped from the result rather
 * than thrown, the same defensive-not-fatal posture `findHouseholdById`
 * callers use elsewhere in this codebase.
 */
export const findMenuItems = async (client: PoolClient, menuId: string): Promise<MenuItemRow[]> => {
  const result = await client.query<RawMenuItemRow>(
    `SELECT id, menu_id, recipe_id, day_of_week, meal_slot, slot_role, servings_override, made_at
     FROM menu_items
     WHERE menu_id = $1
     ORDER BY day_of_week, meal_slot, created_at`,
    [menuId],
  );

  const recipeIds = [...new Set(result.rows.map((row) => row.recipe_id))];
  const recipes = await findRecipesByIds(client, recipeIds);
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));

  return result.rows.flatMap((row) => {
    const recipe = recipesById.get(row.recipe_id);
    if (recipe === undefined) {
      return [];
    }
    return [
      {
        id: row.id,
        menuId: row.menu_id,
        recipe,
        dayOfWeek: row.day_of_week,
        mealSlot: row.meal_slot,
        slotRole: row.slot_role,
        servingsOverride: row.servings_override,
        madeAt: row.made_at,
      },
    ];
  });
};
