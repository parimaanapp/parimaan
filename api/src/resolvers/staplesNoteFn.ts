import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { findHouseholdById } from '../repositories/householdRepository.js';
import { findMenuById, findMenuItems } from '../repositories/menuRepository.js';
import { findRecipeIngredientsByRecipeIds } from '../repositories/recipeRepository.js';
import { findShoppingListById, updateAiStaplesNote } from '../repositories/shoppingListRepository.js';
import { computeRecipeSetHash } from '../domain/recipeSetHash.js';
import { getCachedStaplesNote, putCachedStaplesNote } from '../aiCache/staplesNoteCache.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { buildStaplesNoteContext, buildStaplesNotePrompt } from '../../prompts/staplesNote.js';
import type { StaplesNoteRecipeInput } from '../../prompts/staplesNote.js';
import { invokeModel } from '../ai/invokeModel.js';
import { staplesNoteOutputSchema } from '../ai/schemas/staplesNote.js';
import type { StaplesNoteOutput } from '../ai/schemas/staplesNote.js';
import { AppError } from '../errors.js';

/**
 * `'staplesNote'` at 20/day per (effective) caller (D7, `E2E_MVP_PLAN.md`
 * §23.2.7) — matches `'freeformParse'`'s own precedent exactly rather than
 * a freshly-derived number. Rate-limit action names are frozen production
 * data once deployed (`dailyActionLimiter.ts`'s own doc) — not cosmetic.
 */
export const MAX_STAPLES_NOTES_PER_DAY = 20;
const STAPLES_NOTE_ACTION = 'staplesNote';

/**
 * D2's own deliberately minimal invocation payload (`E2E_MVP_PLAN.md`
 * §23.2.2) — `generateShoppingList`/`regenerateShoppingList` pass only
 * these two fields; this Lambda re-reads everything else fresh.
 */
export interface StaplesNoteFnEvent {
  listId: string;
  householdId: string;
}

const eventSchema = z.object({
  listId: z.string().uuid(),
  householdId: z.string().uuid(),
});

export interface StaplesNoteFnDeps {
  getPool: () => Promise<Pool>;
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  /** Injectable seam over `invokeModel` — see `parseFreeformRecipe.ts`'s identical `parseWithModel` doc for why. */
  callModel?: (prompt: string) => Promise<StaplesNoteOutput>;
  /** Injectable clock for the rate limiter's UTC-day bucketing. */
  now?: () => Date;
}

let memoizedDdbClient: DynamoDBDocumentClient | undefined;
const getProductionDdbClient = (): DynamoDBDocumentClient => {
  memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return memoizedDdbClient;
};

const productionCallModel = (prompt: string): Promise<StaplesNoteOutput> => invokeModel(prompt, staplesNoteOutputSchema);

export const productionDeps: StaplesNoteFnDeps = {
  getPool,
  getDdbClient: getProductionDdbClient,
  getCacheTableName: () => loadCacheTableName(),
  callModel: productionCallModel,
};

/**
 * The week's planned recipes, read fresh via `listId` → its originating
 * menu → that menu's current `menu_items` — the same menu-hydration shape
 * `shoppingListGenerationPipeline.ts`'s own `buildRecipesById` reads,
 * duplicated here (not imported) because that helper is private to the
 * shopping-list generation pipeline and shapes its output for
 * `aggregateIngredients`, not for `StaplesNoteRecipeInput`. Returns `null`
 * when the list/menu genuinely can't be resolved (deleted since the invoke
 * was fired, or a malformed payload) — the caller treats this as a
 * best-effort no-op, never an error to retry.
 */
const readPlannedRecipes = async (
  client: PoolClient,
  listId: string,
): Promise<{ recipeInputs: StaplesNoteRecipeInput[]; hashPairs: { recipeId: string; servingsOverride: number | null }[] } | null> => {
  const list = await findShoppingListById(client, listId);
  if (list === null || list.generatedFromMenuId === null) {
    return null;
  }
  const menu = await findMenuById(client, list.generatedFromMenuId);
  if (menu === null) {
    return null;
  }
  const menuItems = await findMenuItems(client, menu.id);

  const hashPairs = menuItems.map((item) => ({ recipeId: item.recipe.id, servingsOverride: item.servingsOverride }));

  const recipeIds = [...new Set(menuItems.map((item) => item.recipe.id))];
  const ingredients = await findRecipeIngredientsByRecipeIds(client, recipeIds);
  const ingredientsByRecipe = new Map<string, { name: string }[]>();
  for (const ingredient of ingredients) {
    const existing = ingredientsByRecipe.get(ingredient.recipeId) ?? [];
    existing.push({ name: ingredient.name });
    ingredientsByRecipe.set(ingredient.recipeId, existing);
  }

  const recipeInputs: StaplesNoteRecipeInput[] = menuItems.map((item) => ({
    id: item.recipe.id,
    title: item.recipe.title,
    role: item.recipe.role,
    ingredients: ingredientsByRecipe.get(item.recipe.id) ?? [],
  }));

  return { recipeInputs, hashPairs };
};

/**
 * Resolves the RLS actor `staplesNoteFn` reads/writes as. The invoke
 * payload (D2) deliberately carries no user id — only the triggering
 * resolver's own `withUserTransaction` scope knows who called it, and that
 * identity is intentionally not threaded through. Every RLS-protected table
 * this Lambda touches (`shopping_lists`, `menus`, ...) requires SOME
 * `parimaan.user_id` to evaluate its membership-subquery policy, so this
 * resolves the household's own `primaryUserId` (`households` itself has NO
 * RLS policy — see `householdRepository.ts`'s own doc on that) and uses it
 * as a stable, always-valid stand-in. This is a deliberate, documented
 * deviation from D7's literal "keyed by the calling user" wording (no
 * caller identity is available here to key by) — the household's primary
 * user is the most conservative substitute available: a real member of
 * exactly this household, stable across every list/regenerate for it, and
 * already the identity `createHousehold` grants read/write access to
 * `household_settings` under.
 */
const resolveActingUserId = async (pool: Pool, householdId: string): Promise<string | null> => {
  const client = await pool.connect();
  try {
    const household = await findHouseholdById(client, householdId);
    return household === null ? null : household.primaryUserId;
  } finally {
    client.release();
  }
};

/**
 * Direct-Lambda entry point for `staplesNoteFn` (W17 S3, `E2E_MVP_PLAN.md`
 * §23.2.2/§23.2.6/§23.2.7 — D2/D6/D7 in full). NOT an AppSync resolver —
 * invoked only by `generateShoppingList`/`regenerateShoppingList`'s own
 * post-commit async `InvocationType: 'Event'` invoke
 * (`aiInvoke/staplesNoteInvoker.ts`). Lives under `resolvers/` anyway (not
 * a new `lambdas/` directory) because this codebase already treats
 * "resolvers/" as "direct-Lambda entry points" generically — every existing
 * file there is a thin `handler` export wired to ONE specific invocation
 * shape (AppSync's, so far); this is simply the first one AppSync itself
 * never calls. Introducing a whole new top-level directory for exactly one
 * file seemed like more novelty than the actual difference (the invoker)
 * warranted.
 *
 * Deliberately returns `void` and never re-throws a business-logic failure
 * (cache hit vs. miss, rate limit exhausted, any of `invokeModel`'s six
 * taxonomy codes) — those are all expected, best-effort outcomes with no
 * synchronous caller left to see them (D2/D7's own framing). A genuine
 * infrastructure failure reading/writing Postgres or DynamoDB DOES
 * propagate — that's what Lambda's own built-in automatic retry (two
 * attempts, no DLQ, D2's own explicit call) exists to catch.
 */
export const createStaplesNoteFnHandler =
  (deps: StaplesNoteFnDeps) =>
  async (rawEvent: StaplesNoteFnEvent): Promise<void> => {
    const parsed = eventSchema.safeParse(rawEvent);
    if (!parsed.success) {
      console.error('staplesNoteFn: invalid invocation payload', parsed.error);
      return;
    }
    const { listId, householdId } = parsed.data;

    const pool = await deps.getPool();
    const actingUserId = await resolveActingUserId(pool, householdId);
    if (actingUserId === null) {
      console.error(`staplesNoteFn: no household found for householdId=${householdId}`);
      return;
    }

    const planned = await withUserTransaction(actingUserId, (client) => readPlannedRecipes(client, listId), pool);
    if (planned === null) {
      console.error(`staplesNoteFn: could not resolve a planned menu for listId=${listId}`);
      return;
    }

    const recipeSetHash = computeRecipeSetHash(planned.hashPairs);
    const ddbClient = deps.getDdbClient();
    const tableName = deps.getCacheTableName();

    const result = await resolveNote(deps, ddbClient, tableName, recipeSetHash, planned.recipeInputs, actingUserId);
    if (result === null) {
      return;
    }

    await withUserTransaction(actingUserId, (client) => updateAiStaplesNote(client, listId, result.note), pool);
  };

/**
 * Cache-then-rate-limit-then-model resolution (D6/D7) — returns `null` on
 * every best-effort "nothing to write" outcome (rate limited, model
 * failure) so the caller's write step is skipped entirely, or the note to
 * write (already trimmed to `null` for an empty model result, per D3) plus
 * whether it came from the cache (so the caller never re-writes an
 * already-cached entry).
 */
const resolveNote = async (
  deps: StaplesNoteFnDeps,
  ddbClient: DynamoDBDocumentClient,
  tableName: string,
  recipeSetHash: string,
  recipeInputs: StaplesNoteRecipeInput[],
  actingUserId: string,
): Promise<{ note: string | null } | null> => {
  const cached = await getCachedStaplesNote(ddbClient, tableName, recipeSetHash);
  if (cached !== null) {
    return { note: cached.length === 0 ? null : cached };
  }

  try {
    await checkAndIncrementDailyAction(
      ddbClient,
      tableName,
      STAPLES_NOTE_ACTION,
      actingUserId,
      MAX_STAPLES_NOTES_PER_DAY,
      `You've reached today's limit of ${MAX_STAPLES_NOTES_PER_DAY} staples notes. Try again tomorrow.`,
      deps.now,
    );

    const callModel = deps.callModel ?? productionCallModel;
    const context = buildStaplesNoteContext(recipeInputs);
    const output = await callModel(buildStaplesNotePrompt(context));
    const note = output.note.trim();

    await putCachedStaplesNote(ddbClient, tableName, recipeSetHash, note, deps.now);
    return { note: note.length === 0 ? null : note };
  } catch (error) {
    if (error instanceof AppError) {
      // RATE_LIMITED or any of invokeModel's six taxonomy codes — a
      // named, expected, best-effort failure. Log and stop; never retried
      // beyond invokeModel's own internal transport/reinforcement chain
      // (D2's own explicit "no retry beyond invokeModel's own internal
      // retry chain").
      console.error(`staplesNoteFn: no note written (${error.errorType})`, error);
      return null;
    }
    throw error;
  }
};

// Unlike every AppSync resolver in this codebase, this handler is NOT
// wrapped in `withErrorHandling` — there is no AppSync client waiting on a
// client-safe error shape here, only Lambda's own async-invoke retry
// machinery, which wants the original thrown error (or none at all) rather
// than a sanitized replacement.
export const handler = createStaplesNoteFnHandler(productionDeps);
