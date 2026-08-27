import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  insertRecipe,
  insertRecipeIngredient as insertRecipeIngredientRepo,
} from '../repositories/recipeRepository.js';
import type { InsertRecipeIngredientInput, InsertRecipeInput } from '../repositories/recipeRepository.js';
import { toGraphQLRecipe } from '../mappers/recipe.js';
import type { GraphQLRecipe } from '../mappers/recipe.js';
import { createRecipeArgsSchema } from '../validation/createRecipe.js';
import type { RecipeInput } from '../validation/createRecipe.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

const DEFAULT_SERVINGS = 4;

/**
 * Fills in the DB-column defaults explicitly (`servings ?? 4`,
 * `inRotation ?? true`) rather than relying on the column `DEFAULT` — an
 * explicit Zod-parsed `null` would otherwise bind as SQL `NULL` and violate
 * the `NOT NULL` constraint instead of falling through to it. `role` has no
 * such fallback: it is required with no default, the "role assignment
 * required" DoD gate's actual enforcement point (§12.7 D1/D2).
 */
const toInsertRecipeInput = (
  householdId: string,
  input: RecipeInput,
  createdBy: string,
): InsertRecipeInput => ({
  householdId,
  sourceType: 'user',
  title: input.title,
  description: input.description ?? null,
  servings: input.servings ?? DEFAULT_SERVINGS,
  prepMin: input.prepMin ?? null,
  cookMin: input.cookMin ?? null,
  cuisineTier1: input.cuisineTier1 ?? null,
  cuisineTier2: input.cuisineTier2 ?? null,
  dietaryTags: input.dietaryTags ?? [],
  role: input.role,
  inRotation: input.inRotation ?? true,
  steps: input.steps,
  createdBy,
});

const toInsertRecipeIngredientInput = (
  recipeId: string,
  ingredient: RecipeInput['ingredients'][number],
  sortOrder: number,
): InsertRecipeIngredientInput => ({
  recipeId,
  name: ingredient.name,
  quantity: ingredient.quantity ?? null,
  unit: ingredient.unit ?? null,
  category: ingredient.category ?? null,
  notes: ingredient.notes ?? null,
  isStaple: ingredient.isStaple ?? false,
  sortOrder,
});

export interface CreateRecipeResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `insertRecipeIngredient`'s own signature, for forced-mid-batch-failure/rollback tests — same shape as `bulkAddPantryItems.ts`'s `insertPantryItem` seam. */
  insertRecipeIngredient?: typeof insertRecipeIngredientRepo;
}

export const productionDeps: CreateRecipeResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.createRecipe`. Flow matches
 * `addPantryItem.ts`: validate identity → validate `{ householdId, input }`
 * → resolve caller → `requireHouseholdMember` inside a single
 * `withUserTransaction` scope → insert parent row, then loop-insert
 * ingredients (array index becomes `sortOrder` — there is no client-
 * supplied ordering, `shared/schema.graphql`'s own doc on `RecipeInput`).
 * A failure on ingredient *k* rolls back the whole transaction, undoing
 * the parent row and ingredients `0..k-1` too — `withUserTransaction`'s own
 * catch-and-rollback, not a per-insert try/catch here (E2E_MVP_PLAN.md
 * §12.3 S3, same rollback shape as `bulkAddPantryItems.ts`).
 *
 * `sourceType` is always `'user'` here — never client-suppliable, `RecipeInput`
 * has no such field in the SDL at all (§12.2.3). `createdBy` is exclusively
 * the verified caller. See `toInsertRecipeInput`'s own doc for the
 * explicit-default-fallback reasoning.
 */
export const createCreateRecipeHandler =
  (deps: CreateRecipeResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; input: unknown }>,
  ): Promise<GraphQLRecipe> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = createRecipeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, input } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);
    const insertIngredient = deps.insertRecipeIngredient ?? insertRecipeIngredientRepo;

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const recipe = await insertRecipe(client, toInsertRecipeInput(householdId, input, callerUser.id));

        for (const [index, ingredient] of input.ingredients.entries()) {
          await insertIngredient(client, toInsertRecipeIngredientInput(recipe.id, ingredient, index));
        }

        return toGraphQLRecipe(recipe);
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createCreateRecipeHandler`'s returned function.
export const handler = withErrorHandling(createCreateRecipeHandler(productionDeps));
