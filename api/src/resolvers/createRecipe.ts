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
import type { RecipeInput, RecipeSourceAttribution } from '../validation/createRecipe.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

const DEFAULT_SERVINGS = 4;

/**
 * Resolves the `source` argument (§13.2.4 D2) to the two columns it
 * actually controls — absent/`null` (every pre-W7 caller) means
 * `sourceType: 'user'`, `sourceUrl: null`; a `freeform_ai` attribution
 * also has `sourceUrl: null` (the validation schema already guarantees
 * `source.sourceUrl` is only ever set when `sourceType: 'url'`, so this
 * is a straightforward pass-through, not a second enforcement point).
 */
const resolveSourceColumns = (source: RecipeSourceAttribution | null | undefined): Pick<InsertRecipeInput, 'sourceType' | 'sourceUrl'> =>
  source === null || source === undefined
    ? { sourceType: 'user', sourceUrl: null }
    : { sourceType: source.sourceType, sourceUrl: source.sourceUrl ?? null };

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
  source: RecipeSourceAttribution | null | undefined,
  createdBy: string,
): InsertRecipeInput => ({
  householdId,
  ...resolveSourceColumns(source),
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
 * `sourceType`/`sourceUrl` come from the optional `source` argument (W7
 * S6, §13.2.4 D2) via `resolveSourceColumns` — absent (every pre-W7
 * caller, unchanged) resolves to `'user'`/`null`; the Zod schema
 * (`validation/createRecipe.ts`) is what actually restricts client-
 * suppliable `sourceType` values to `url`/`freeform_ai` and enforces
 * `sourceUrl` required-iff-`url`, not this resolver. `createdBy` is
 * exclusively the verified caller. See `toInsertRecipeInput`'s own doc
 * for the explicit-default-fallback reasoning.
 */
export const createCreateRecipeHandler =
  (deps: CreateRecipeResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; input: unknown; source?: unknown }>,
  ): Promise<GraphQLRecipe> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = createRecipeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, input, source } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);
    const insertIngredient = deps.insertRecipeIngredient ?? insertRecipeIngredientRepo;

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const recipe = await insertRecipe(client, toInsertRecipeInput(householdId, input, source, callerUser.id));

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
