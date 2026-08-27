import type { PoolClient } from 'pg';

export type RecipeSourceType = 'user' | 'url' | 'curated' | 'ai' | 'freeform_ai';

export interface RecipeRow {
  id: string;
  householdId: string;
  sourceType: RecipeSourceType;
  sourceUrl: string | null;
  sourceRawText: string | null;
  title: string;
  description: string | null;
  servings: number;
  prepMin: number | null;
  cookMin: number | null;
  cuisineTier1: string | null;
  cuisineTier2: string | null;
  dietaryTags: string[];
  role: string;
  inRotation: boolean;
  isFavorite: boolean;
  steps: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RawRecipeRow {
  id: string;
  household_id: string;
  source_type: RecipeSourceType;
  source_url: string | null;
  source_raw_text: string | null;
  title: string;
  description: string | null;
  servings: number;
  prep_min: number | null;
  cook_min: number | null;
  cuisine_tier1: string | null;
  cuisine_tier2: string | null;
  // JSONB — `pg` hands this back already parsed into a JS array, same as
  // `householdRepository.ts`'s `cuisine_tier1`/`dietary_tags` columns.
  dietary_tags: string[];
  role: string;
  in_rotation: boolean;
  is_favorite: boolean;
  steps: string[];
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const mapRecipeRow = (row: RawRecipeRow): RecipeRow => ({
  id: row.id,
  householdId: row.household_id,
  sourceType: row.source_type,
  sourceUrl: row.source_url,
  sourceRawText: row.source_raw_text,
  title: row.title,
  description: row.description,
  servings: row.servings,
  prepMin: row.prep_min,
  cookMin: row.cook_min,
  cuisineTier1: row.cuisine_tier1,
  cuisineTier2: row.cuisine_tier2,
  dietaryTags: row.dietary_tags,
  role: row.role,
  inRotation: row.in_rotation,
  isFavorite: row.is_favorite,
  steps: row.steps,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface FindRecipesFilter {
  /** Exact match against `role`. Absent = no filter. */
  role?: string;
  /** Exact match against `is_favorite`. Absent = no filter. */
  isFavorite?: boolean;
}

/**
 * `ORDER BY is_favorite DESC, LOWER(title)` — PRD §7.1: "favorites and
 * rotation surfaced first" (E2E_MVP_PLAN.md §12.2.7). Deliberately never
 * selects/joins `recipe_ingredients` here — `Recipe.ingredients` is a
 * separate field resolver (`recipeIngredients.ts`) precisely so a query
 * that doesn't select it never pays for the join (§12.2.7/D5).
 */
export const findRecipes = async (
  client: PoolClient,
  householdId: string,
  filter: FindRecipesFilter = {},
): Promise<RecipeRow[]> => {
  const result = await client.query<RawRecipeRow>(
    `SELECT * FROM recipes
     WHERE household_id = $1
       AND ($2::text IS NULL OR role = $2)
       AND ($3::boolean IS NULL OR is_favorite = $3)
     ORDER BY is_favorite DESC, LOWER(title)`,
    [householdId, filter.role ?? null, filter.isFavorite ?? null],
  );
  return result.rows.map(mapRecipeRow);
};

export interface RecipeIngredientRow {
  id: string;
  recipeId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  notes: string | null;
  isStaple: boolean;
  sortOrder: number;
}

interface RawRecipeIngredientRow {
  id: string;
  recipe_id: string;
  name: string;
  // NUMERIC comes back from `pg` as a string — same reasoning as
  // `pantryRepository.ts`'s `quantity`/`low_threshold`.
  quantity: string | null;
  unit: string | null;
  category: string | null;
  notes: string | null;
  is_staple: boolean;
  sort_order: number;
}

const mapRecipeIngredientRow = (row: RawRecipeIngredientRow): RecipeIngredientRow => ({
  id: row.id,
  recipeId: row.recipe_id,
  name: row.name,
  quantity: row.quantity === null ? null : Number(row.quantity),
  unit: row.unit,
  category: row.category,
  notes: row.notes,
  isStaple: row.is_staple,
  sortOrder: row.sort_order,
});

/**
 * Backs the `Recipe.ingredients` field resolver — no `householdId` to gate
 * on, since a field resolver only ever receives its parent (`Recipe.id`
 * via `event.source`), never a fresh client-supplied household argument.
 * `recipe_ingredients`' RLS parent-join policy
 * (`1787808112003_recipes.ts`, E2E_MVP_PLAN.md §12.2.2) is therefore the
 * ONLY authorization on this query, not defense-in-depth on top of an app
 * layer check — a non-member's call returns an empty array, identical to a
 * recipe that genuinely has no ingredients, the same
 * indistinguishable-by-design pattern as `pantryRepository.ts`'s
 * `findPantryItemById`.
 */
export const findRecipeIngredientsByRecipeId = async (
  client: PoolClient,
  recipeId: string,
): Promise<RecipeIngredientRow[]> => {
  const result = await client.query<RawRecipeIngredientRow>(
    `SELECT * FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
    [recipeId],
  );
  return result.rows.map(mapRecipeIngredientRow);
};

export interface InsertRecipeInput {
  householdId: string;
  sourceType: RecipeSourceType;
  title: string;
  description: string | null;
  servings: number;
  prepMin: number | null;
  cookMin: number | null;
  cuisineTier1: string | null;
  cuisineTier2: string | null;
  dietaryTags: string[];
  role: string;
  inRotation: boolean;
  steps: string[];
  createdBy: string;
}

/**
 * Inserts the parent `recipes` row only — ingredients are a separate
 * `insertRecipeIngredient` call per row (below), left to the caller to loop
 * over on the SAME `client`/transaction, matching `bulkAddPantryItems.ts`'s
 * resolver-level loop rather than adding a second savepoint layer: the
 * whole `withUserTransaction` scope already rolls back atomically on any
 * throw (E2E_MVP_PLAN.md §12.3 S3), so a failure on ingredient *k* undoes
 * both the parent row and ingredients `0..k-1` for free.
 */
export const insertRecipe = async (client: PoolClient, input: InsertRecipeInput): Promise<RecipeRow> => {
  const result = await client.query<RawRecipeRow>(
    `INSERT INTO recipes
       (household_id, source_type, title, description, servings, prep_min, cook_min, cuisine_tier1, cuisine_tier2, dietary_tags, role, in_rotation, steps, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.householdId,
      input.sourceType,
      input.title,
      input.description,
      input.servings,
      input.prepMin,
      input.cookMin,
      input.cuisineTier1,
      input.cuisineTier2,
      JSON.stringify(input.dietaryTags),
      input.role,
      input.inRotation,
      JSON.stringify(input.steps),
      input.createdBy,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertRecipe: expected a returned row.');
  }
  return mapRecipeRow(row);
};

export interface InsertRecipeIngredientInput {
  recipeId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  notes: string | null;
  isStaple: boolean;
  sortOrder: number;
}

export const insertRecipeIngredient = async (
  client: PoolClient,
  input: InsertRecipeIngredientInput,
): Promise<RecipeIngredientRow> => {
  const result = await client.query<RawRecipeIngredientRow>(
    `INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, category, notes, is_staple, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.recipeId,
      input.name,
      input.quantity,
      input.unit,
      input.category,
      input.notes,
      input.isStaple,
      input.sortOrder,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertRecipeIngredient: expected a returned row.');
  }
  return mapRecipeIngredientRow(row);
};
