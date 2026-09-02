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
