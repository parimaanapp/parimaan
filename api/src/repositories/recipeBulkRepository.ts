import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withIngredientFkFallback } from './ingredientFkFallback.js';
import type { InsertRecipeInput, InsertRecipeIngredientInput } from './recipeRepository.js';

/** One recipe plus its ingredients, ready to be written in a batch. `recipeId` on each ingredient is filled in here. */
export interface BulkRecipeInput {
  readonly recipe: InsertRecipeInput;
  readonly ingredients: readonly Omit<InsertRecipeIngredientInput, 'recipeId'>[];
}

const insertRecipeRows = async (
  client: PoolClient,
  ids: readonly string[],
  items: readonly BulkRecipeInput[],
): Promise<void> => {
  const recipes = items.map((item) => item.recipe);
  await client.query(
    `INSERT INTO recipes
       (id, household_id, source_type, source_url, title, description, servings, prep_min, cook_min,
        cuisine_tier1, cuisine_tier2, dietary_tags, role, in_rotation, steps, created_by)
     SELECT id, household_id, source_type, source_url, title, description, servings, prep_min, cook_min,
            cuisine_tier1, cuisine_tier2, dietary_tags::jsonb, role, in_rotation, steps::jsonb, created_by
       FROM unnest(
         $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::int[],
         $10::text[], $11::text[], $12::text[], $13::text[], $14::bool[], $15::text[], $16::uuid[]
       ) AS t(id, household_id, source_type, source_url, title, description, servings, prep_min, cook_min,
              cuisine_tier1, cuisine_tier2, dietary_tags, role, in_rotation, steps, created_by)`,
    [
      ids,
      recipes.map((r) => r.householdId),
      recipes.map((r) => r.sourceType),
      recipes.map((r) => r.sourceUrl),
      recipes.map((r) => r.title),
      recipes.map((r) => r.description),
      recipes.map((r) => r.servings),
      recipes.map((r) => r.prepMin),
      recipes.map((r) => r.cookMin),
      recipes.map((r) => r.cuisineTier1),
      recipes.map((r) => r.cuisineTier2),
      recipes.map((r) => JSON.stringify(r.dietaryTags)),
      recipes.map((r) => r.role),
      recipes.map((r) => r.inRotation),
      recipes.map((r) => JSON.stringify(r.steps)),
      recipes.map((r) => r.createdBy),
    ],
  );
};

const insertIngredientRows = async (
  client: PoolClient,
  rows: readonly InsertRecipeIngredientInput[],
): Promise<void> => {
  await client.query(
    `INSERT INTO recipe_ingredients
       (recipe_id, name, quantity, unit, category, notes, is_staple, sort_order, ingredient_id, catalog_match)
     SELECT * FROM unnest(
       $1::uuid[], $2::text[], $3::numeric[], $4::text[], $5::text[], $6::text[], $7::bool[], $8::int[], $9::text[], $10::text[]
     )`,
    [
      rows.map((r) => r.recipeId),
      rows.map((r) => r.name),
      rows.map((r) => r.quantity),
      rows.map((r) => r.unit),
      rows.map((r) => r.category),
      rows.map((r) => r.notes),
      rows.map((r) => r.isStaple),
      rows.map((r) => r.sortOrder),
      rows.map((r) => r.ingredientId ?? null),
      rows.map((r) => r.catalogMatch ?? null),
    ],
  );
};

/**
 * Multi-row insert of whole recipes (rows in `recipes`, then their rows in
 * `recipe_ingredients`) using two `INSERT ... SELECT FROM unnest(...)`
 * statements, however many recipes there are. Seeding a household with the
 * curated corpus (about 200 recipes and 2,200 ingredients) used to cost
 * about 2,400 round trips; it costs 2 (plus a savepoint pair when any
 * ingredient carries a catalog id). Runs on the caller's open transaction, so
 * RLS and all-or-nothing behaviour are those of the per-row inserts.
 *
 * Recipe ids are generated here so the ingredient rows can reference them
 * without relying on `RETURNING` row order. Column values are identical to
 * what `insertRecipe` / `insertRecipeIngredient` write.
 *
 * If a catalog id is stale (deleted by a sync while the cache still held it)
 * the ingredient batch is retried once with every catalog id dropped, as the
 * per-row path does for a single row; `catalog:backfill` reconciles them.
 *
 * @returns the ids of the inserted recipes, in input order.
 */
export const insertRecipesWithIngredients = async (
  client: PoolClient,
  items: readonly BulkRecipeInput[],
): Promise<string[]> => {
  if (items.length === 0) {
    return [];
  }
  const ids = items.map(() => randomUUID());
  await insertRecipeRows(client, ids, items);

  const ingredientRows = items.flatMap((item, index) =>
    item.ingredients.map((ingredient): InsertRecipeIngredientInput => ({ ...ingredient, recipeId: ids[index] as string })),
  );
  if (ingredientRows.length > 0) {
    const hasCatalogId = ingredientRows.some((row) => (row.ingredientId ?? null) !== null);
    await withIngredientFkFallback(client, hasCatalogId, (drop) =>
      insertIngredientRows(
        client,
        drop ? ingredientRows.map((row) => ({ ...row, ingredientId: null, catalogMatch: null })) : ingredientRows,
      ),
    );
  }
  return ids;
};
