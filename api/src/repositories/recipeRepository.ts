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

/**
 * Reads a single recipe by `id` — no `householdId` argument, same `id`-only
 * shape as `deleteRecipeById`/`updateRecipePartial`: RLS alone gates this,
 * so a nonexistent id and a real id in another household are both `null`
 * here, indistinguishable by design (`resolvers/recipe.ts` turns `null`
 * into the identical `NotFoundError` either way). Deliberately never
 * selects/joins `recipe_ingredients` — same §12.2.7/D5 reasoning as
 * `findRecipes`; `Recipe.ingredients` is the separate field resolver the
 * Detail screen's own selection set triggers.
 */
export const findRecipeById = async (client: PoolClient, id: string): Promise<RecipeRow | null> => {
  const result = await client.query<RawRecipeRow>(`SELECT * FROM recipes WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row === undefined ? null : mapRecipeRow(row);
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
  sourceUrl: string | null;
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
       (household_id, source_type, source_url, title, description, servings, prep_min, cook_min, cuisine_tier1, cuisine_tier2, dietary_tags, role, in_rotation, steps, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      input.householdId,
      input.sourceType,
      input.sourceUrl,
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

/**
 * Removes every ingredient row for a recipe — the "delete" half of
 * `Mutation.updateRecipe`'s ingredients-replace-whole-list-when-present
 * semantic (E2E_MVP_PLAN.md §12.2.4). Always paired with a bulk
 * `insertRecipeIngredient` loop on the SAME `client`/transaction by the
 * resolver, so a failure on the re-insert half rolls back the delete too —
 * no window where a recipe is left with zero ingredients due to a partial
 * failure.
 */
export const deleteRecipeIngredientsByRecipeId = async (
  client: PoolClient,
  recipeId: string,
): Promise<void> => {
  await client.query(`DELETE FROM recipe_ingredients WHERE recipe_id = $1`, [recipeId]);
};

export interface RecipePatch {
  title?: string;
  description?: string;
  servings?: number;
  prepMin?: number;
  cookMin?: number;
  cuisineTier1?: string;
  cuisineTier2?: string;
  dietaryTags?: string[];
  role?: string;
  inRotation?: boolean;
  steps?: string[];
}

/** `undefined` → `null` (SQL's "no value bound", `COALESCE`'s "keep existing"); anything else passes through unchanged. */
const orNull = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

/** Same as `orNull`, but JSON-serializes a present array first — for the two JSONB columns (`dietary_tags`, `steps`). */
const orNullJson = (value: string[] | undefined): string | null =>
  value === undefined ? null : JSON.stringify(value);

/**
 * Builds the bind-parameter array for `updateRecipePartial`'s `UPDATE ...
 * COALESCE($n, col)` statement — an absent patch field becomes SQL `NULL`,
 * which `COALESCE` treats as "keep the existing value" (never intended as
 * "clear the column"; the patch schema already rejects an explicit
 * client-supplied `null` before this is ever called). Extracted purely to
 * keep `updateRecipePartial` itself under this repo's ESLint complexity cap.
 */
const toUpdateRecipeParams = (id: string, patch: RecipePatch): unknown[] => [
  id,
  orNull(patch.title),
  orNull(patch.description),
  orNull(patch.servings),
  orNull(patch.prepMin),
  orNull(patch.cookMin),
  orNull(patch.cuisineTier1),
  orNull(patch.cuisineTier2),
  orNullJson(patch.dietaryTags),
  orNull(patch.role),
  orNull(patch.inRotation),
  orNullJson(patch.steps),
];

/**
 * Applies `patch` to a single `recipes` row via one `UPDATE ... SET col =
 * COALESCE($n, col), ...` statement — identical pattern to
 * `pantryRepository.ts`'s `updatePantryItemPartial`: an absent patch field
 * binds SQL `NULL`, and `COALESCE` keeps that column's existing value
 * unchanged. `updated_at` is bumped unconditionally, regardless of which
 * fields actually changed (the RED test in the locked plan asserts this).
 * Returns `null` if no row matched `id` — either it doesn't exist, or (via
 * RLS's `USING` clause) it belongs to a household the caller isn't a
 * member of; the two cases are indistinguishable by design, matching
 * `updatePantryItemPartial`'s own doc.
 *
 * Deliberately does NOT touch `recipe_ingredients` — that's
 * `deleteRecipeIngredientsByRecipeId` + a bulk `insertRecipeIngredient`
 * loop, run separately by the resolver only when `ingredients` is present
 * in the patch at all (§12.2.4's distinct "present vs. absent" semantic,
 * which this SQL-level COALESCE pattern can't express for a child table).
 */
export const updateRecipePartial = async (
  client: PoolClient,
  id: string,
  patch: RecipePatch,
): Promise<RecipeRow | null> => {
  const result = await client.query<RawRecipeRow>(
    `UPDATE recipes SET
       title = COALESCE($2::text, title),
       description = COALESCE($3::text, description),
       servings = COALESCE($4::int, servings),
       prep_min = COALESCE($5::int, prep_min),
       cook_min = COALESCE($6::int, cook_min),
       cuisine_tier1 = COALESCE($7::text, cuisine_tier1),
       cuisine_tier2 = COALESCE($8::text, cuisine_tier2),
       dietary_tags = COALESCE($9::jsonb, dietary_tags),
       role = COALESCE($10::text, role),
       in_rotation = COALESCE($11::boolean, in_rotation),
       steps = COALESCE($12::jsonb, steps),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    toUpdateRecipeParams(id, patch),
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRecipeRow(row);
};

/**
 * Deletes a single recipe by id and returns the row that was deleted
 * (`null` if none matched — same indistinguishable not-found-vs-not-mine
 * reasoning as `updateRecipePartial`). Returning the deleted row rather
 * than a boolean matches `deletePantryItemById`'s precedent (§11.2.1) —
 * `ON DELETE CASCADE` on `recipe_ingredients.recipe_id` handles the child
 * rows for free.
 */
export const deleteRecipeById = async (client: PoolClient, id: string): Promise<RecipeRow | null> => {
  const result = await client.query<RawRecipeRow>(`DELETE FROM recipes WHERE id = $1 RETURNING *`, [id]);
  const row = result.rows[0];
  return row === undefined ? null : mapRecipeRow(row);
};

/**
 * Sets `is_favorite` unconditionally to `favorite` (not a toggle — the
 * caller always sends the desired end state, matching
 * `Mutation.favoriteRecipe(id, favorite: Boolean!)`'s SDL). Idempotent by
 * construction: setting an already-favorite recipe favorite again is a
 * plain `UPDATE` that matches the same row and returns it unchanged bar
 * `updated_at`, never a conflict. Same `null`-means-not-found-or-not-mine
 * reasoning as `updateRecipePartial`/`deleteRecipeById`. Favoriting is
 * household-level, not per-user (PRD §7.1) — there is deliberately no
 * per-caller column here, `is_favorite` is a single flag every member
 * shares.
 */
export const setRecipeFavorite = async (
  client: PoolClient,
  id: string,
  favorite: boolean,
): Promise<RecipeRow | null> => {
  const result = await client.query<RawRecipeRow>(
    `UPDATE recipes SET is_favorite = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, favorite],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRecipeRow(row);
};

/**
 * Sets `in_rotation` unconditionally to `inRotation` — same shape as
 * `setRecipeFavorite`, backing `Mutation.setInRotation(id,
 * inRotation: Boolean!)`. `in_rotation` is what W10's `autoFillWeek`
 * filters on (`idx_recipes_role`'s partial-index predicate); this mutation
 * only flips the flag, it does not itself consume it.
 */
export const setRecipeInRotation = async (
  client: PoolClient,
  id: string,
  inRotation: boolean,
): Promise<RecipeRow | null> => {
  const result = await client.query<RawRecipeRow>(
    `UPDATE recipes SET in_rotation = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, inRotation],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRecipeRow(row);
};
