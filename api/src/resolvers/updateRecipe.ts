import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool, PoolClient } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  deleteRecipeIngredientsByRecipeId as deleteRecipeIngredientsByRecipeIdRepo,
  insertRecipeIngredient as insertRecipeIngredientRepo,
  updateRecipePartial as updateRecipePartialRepo,
} from '../repositories/recipeRepository.js';
import type { RecipePatch } from '../repositories/recipeRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLRecipe } from '../mappers/recipe.js';
import { updateRecipeArgsSchema } from '../validation/updateRecipe.js';
import type { RecipePatchInput } from '../validation/updateRecipe.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * Strips `ingredients` (handled separately, below — it isn't a `recipes`
 * column) and any `undefined`-valued key — same `exactOptionalPropertyTypes`
 * fix as `updatePantryItem.ts`'s `toPantryItemPatch`: Zod's optional fields
 * type as `T | undefined`, but `RecipePatch` requires absent-not-set.
 */
const toRecipePatch = (input: RecipePatchInput): RecipePatch => {
  const { ingredients, ...scalarFields } = input;
  void ingredients;
  const entries = Object.entries(scalarFields).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as RecipePatch;
};

export interface UpdateRecipeResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seams matching each repo function's own signature, for forced-failure/rollback tests. */
  updateRecipePartial?: typeof updateRecipePartialRepo;
  deleteRecipeIngredientsByRecipeId?: typeof deleteRecipeIngredientsByRecipeIdRepo;
  insertRecipeIngredient?: typeof insertRecipeIngredientRepo;
}

export const productionDeps: UpdateRecipeResolverDeps = { getPool };

/**
 * The "present replaces the whole list" half of §12.2.4's ingredients
 * semantic — deletes every existing ingredient then bulk-inserts the new
 * list (array index becomes `sortOrder`, same as `createRecipe.ts`).
 * Extracted purely to keep the main handler under this repo's ESLint
 * complexity cap; runs on the caller-supplied `client`, so it shares the
 * outer `withUserTransaction` scope and rolls back with everything else.
 */
const replaceRecipeIngredients = async (
  client: PoolClient,
  recipeId: string,
  ingredients: RecipePatchInput['ingredients'],
  deleteAll: typeof deleteRecipeIngredientsByRecipeIdRepo,
  insertOne: typeof insertRecipeIngredientRepo,
): Promise<void> => {
  await deleteAll(client, recipeId);
  for (const [index, ingredient] of (ingredients ?? []).entries()) {
    await insertOne(client, {
      recipeId,
      name: ingredient.name,
      quantity: ingredient.quantity ?? null,
      unit: ingredient.unit ?? null,
      category: ingredient.category ?? null,
      notes: ingredient.notes ?? null,
      isStaple: ingredient.isStaple ?? false,
      sortOrder: index,
    });
  }
};

/**
 * Direct-Lambda resolver for `Mutation.updateRecipe`. Same `id`-only
 * membership resolution as `updatePantryItem.ts` — no `householdId` to gate
 * on with `requireHouseholdMember`; RLS on `recipes` is the sole
 * authorization, and a nonexistent id vs. a real id in another household
 * both surface as the identical `NotFoundError`.
 *
 * `ingredients` gets §12.2.4's distinct "present vs. absent" handling,
 * which the SQL-level `updateRecipePartial` patch can't express for a
 * child table: when `input.ingredients !== undefined` (checked on the
 * PARSED Zod result directly, before `toRecipePatch` strips it) — true for
 * both `[]` and a real array, false only when the client never sent the
 * key at all — every existing ingredient is deleted and the new list
 * bulk-inserted, on the SAME `client`/transaction as the scalar patch, so
 * a failure on the re-insert half rolls back everything (the scalar patch
 * included), not just the ingredients.
 */
export const createUpdateRecipeHandler =
  (deps: UpdateRecipeResolverDeps) =>
  async (event: AppSyncResolverEvent<{ id: unknown; input: unknown }>): Promise<GraphQLRecipe> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = updateRecipeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { id, input } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const updateRecipePartial = deps.updateRecipePartial ?? updateRecipePartialRepo;
        const deleteRecipeIngredientsByRecipeId =
          deps.deleteRecipeIngredientsByRecipeId ?? deleteRecipeIngredientsByRecipeIdRepo;
        const insertRecipeIngredient = deps.insertRecipeIngredient ?? insertRecipeIngredientRepo;

        const recipe = await updateRecipePartial(client, id, toRecipePatch(input));
        if (recipe === null) {
          throw new NotFoundError('Recipe not found.');
        }

        if (input.ingredients !== undefined) {
          await replaceRecipeIngredients(
            client,
            id,
            input.ingredients,
            deleteRecipeIngredientsByRecipeId,
            insertRecipeIngredient,
          );
        }

        return toGraphQLRecipe(recipe);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createUpdateRecipeHandler`'s returned function.
export const handler = withErrorHandling(createUpdateRecipeHandler(productionDeps));
