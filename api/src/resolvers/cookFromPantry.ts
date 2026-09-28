import type { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Pool } from 'pg';
import { buildCookFromPantryPrompt, COOK_MAX_OUTPUT_TOKENS, COOK_TEMPERATURE } from '../../prompts/cookFromPantry.js';
import type { CookVibe } from '../../prompts/cookFromPantry.js';
import { getCachedCookSuggestions, putCachedCookSuggestions } from '../aiCache/cookFromPantryCache.js';
import { emitCookMetric } from '../ai/cookMetric.js';
import type { CookResultOutcome, CookSummary } from '../ai/cookMetric.js';
import { GEMINI_MODEL } from '../ai/geminiClient.js';
import { invokeModel } from '../ai/invokeModel.js';
import { geminiCookSuggestionsSchema } from '../ai/schemas/cookSuggestions.js';
import type { GeminiCookSuggestions } from '../ai/schemas/cookSuggestions.js';
import { toRecipeDraft } from '../ai/schemas/recipeDraft.js';
import type { RecipeDraftResult } from '../ai/schemas/recipeDraft.js';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { allergenWarnings, findDietaryViolations, findSkipViolations } from '../domain/cookPreferenceFilter.js';
import type { FilterableSuggestion } from '../domain/cookPreferenceFilter.js';
import { PROMPT_LIMITS } from '../domain/cookPromptText.js';
import { isPantryTooSmall, selectPromptPantryItems } from '../domain/cookablePantry.js';
import type { CookablePantryItem } from '../domain/cookablePantry.js';
import { groundSuggestion, isGroundedEnough } from '../domain/pantryGrounding.js';
import type { PantryItemRef, PantryMatch } from '../domain/pantryGrounding.js';
import { computePromptHash, computeSuggestionId } from '../domain/promptHash.js';
import { AiTimeoutError, ValidationError } from '../errors.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findSettingsForHousehold } from '../repositories/householdRepository.js';
import type { SettingsRow } from '../repositories/householdRepository.js';
import { findPantryItems } from '../repositories/pantryRepository.js';
import { cookFromPantryArgsSchema } from '../validation/cookFromPantry.js';
import { withErrorHandling } from './withErrorHandling.js';

/** `'cookFromPantry'` at 10/day per user (SD §8.5; reserved since W7 D8). Action names are frozen production data once deployed. */
export const MAX_COOK_REQUESTS_PER_DAY = 10;
const COOK_ACTION = 'cookFromPantry';

/**
 * Time budget (W21 D10). AppSync's 30s ceiling is the real limit, not the
 * Lambda's own timeout. The budget is measured from when the handler starts,
 * so a slow Aurora resume or a cold start eats into what the model gets.
 */
export const HANDLER_BUDGET_MS = 26_000;
export const COOK_DEADLINE_MS = 20_000;
/** Below this the model call is not started at all (and no quota is spent). */
export const MIN_MODEL_BUDGET_MS = 6_000;
/** Kept back for the cache write after the model returns. */
const CACHE_WRITE_RESERVE_MS = 1_000;
/** A cache write that has not finished by then is abandoned: the answer is already computed and AppSync's 30s ceiling is not negotiable. */
export const CACHE_WRITE_TIMEOUT_MS = 1_000;
/** The prompt already caps its lists here; the filters apply the same cap so what is enforced is what the model was shown. */
const MAX_RULE_ITEMS = 200;

export interface CookModelOptions {
  deadlineMs: number;
  temperature: number;
  maxOutputTokens: number;
}

export interface CookFromPantryResolverDeps {
  getPool: () => Promise<Pool>;
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  /** Injectable seam over `invokeModel`, as in `parseFreeformRecipe.ts`. */
  callModel?: (prompt: string, options: CookModelOptions) => Promise<GeminiCookSuggestions>;
  /** Injectable clock for the rate limiter's UTC-day bucketing and the cache TTL. */
  now?: () => Date;
  /** Injectable monotonic clock (ms) for the handler budget. */
  nowMs?: () => number;
  /** Injectable metric sink; defaults to the real EMF line. */
  emitMetric?: (summary: CookSummary) => void;
}

let memoizedDdbClient: DynamoDBDocumentClient | undefined;
const getProductionDdbClient = (): DynamoDBDocumentClient => {
  memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return memoizedDdbClient;
};

const productionCallModel = (prompt: string, options: CookModelOptions): Promise<GeminiCookSuggestions> =>
  invokeModel(prompt, geminiCookSuggestionsSchema, options);

export const productionDeps: CookFromPantryResolverDeps = {
  getPool,
  getDdbClient: getProductionDdbClient,
  getCacheTableName: () => loadCacheTableName(),
  callModel: productionCallModel,
};

export interface CookIngredientMatchResult extends PantryMatch {
  /** The model's own wording for this ingredient (never the pantry row's name: that is `pantryItemName`). */
  ingredient: string;
}

export interface CookSuggestionResult {
  /** Stable across a cache hit: S4's key for UI state (expanded card, "saved" marker, the detail route). */
  id: string;
  draft: RecipeDraftResult;
  ingredientMatches: CookIngredientMatchResult[];
  have: string[];
  missing: string[];
}

export interface CookFromPantryResult {
  outcome: CookResultOutcome;
  /** Echoed so a restored or dead-end screen knows which vibe it is showing. */
  vibe: CookVibe | null;
  suggestions: CookSuggestionResult[];
}

interface HouseholdSnapshot {
  pantry: CookablePantryItem[];
  settings: SettingsRow | null;
}

/** One short transaction that returns before any model call, so no Postgres connection is held across a 5-20s wait (there is no RDS Proxy). */
const readHousehold = (pool: Pool, callerId: string, householdId: string): Promise<HouseholdSnapshot> =>
  withUserTransaction(
    callerId,
    async (client) => {
      await requireHouseholdMember(client, callerId, householdId);
      const rows = await findPantryItems(client, householdId);
      const settings = await findSettingsForHousehold(client, householdId);
      return { pantry: rows.map((r) => ({ name: r.name, category: r.category, quantity: r.quantity })), settings };
    },
    pool,
  );

interface Processed {
  suggestions: CookSuggestionResult[];
  droppedSkip: number;
  droppedDietary: number;
  droppedUngrounded: number;
  meanHaveRatio: number;
}

/** The household's rules, with a missing settings row read as "no rules". */
interface Rules {
  dietaryTags: readonly string[];
  skipIngredients: readonly string[];
  allergens: readonly string[];
  cuisineTier1: readonly string[];
  cuisineTier2Weights: Readonly<Record<string, unknown>>;
}

const NO_RULES: Rules = { dietaryTags: [], skipIngredients: [], allergens: [], cuisineTier1: [], cuisineTier2Weights: {} };

const rulesFrom = (settings: SettingsRow | null): Rules =>
  settings === null
    ? NO_RULES
    : {
        dietaryTags: settings.dietaryTags.slice(0, MAX_RULE_ITEMS),
        skipIngredients: settings.skipIngredients.slice(0, MAX_RULE_ITEMS),
        allergens: settings.allergens.slice(0, MAX_RULE_ITEMS),
        cuisineTier1: settings.cuisineTier1,
        cuisineTier2Weights: settings.cuisineTier2Weights,
      };

const haveRatio = (matches: readonly PantryMatch[]): number => {
  const have = matches.filter((m) => m.status === 'in_pantry').length;
  const missing = matches.filter((m) => m.status === 'missing').length;
  return have + missing === 0 ? 0 : have / (have + missing);
};

type RawSuggestion = GeminiCookSuggestions['suggestions'][number];
type Evaluation = { dropped: 'skip' | 'dietary' | 'ungrounded' } | { kept: CookSuggestionResult; ratio: number };

/**
 * The model's own ingredient names, which is what is filtered and grounded:
 * `toRecipeDraft` folds a vague quantity into the draft's name ("onion (a
 * fistful)"), and grounding that would report a false Missing.
 */
const toFilterable = (raw: RawSuggestion): FilterableSuggestion => ({
  title: raw.title,
  dietaryTags: raw.dietaryTags ?? [],
  ingredients: raw.ingredients.map((i) => ({ name: i.name })),
});

const ruleViolation = (filterable: FilterableSuggestion, rules: Rules): 'skip' | 'dietary' | undefined => {
  if (findSkipViolations(filterable, rules.skipIngredients).length > 0) {
    return 'skip';
  }
  return findDietaryViolations(filterable, rules.dietaryTags).length > 0 ? 'dietary' : undefined;
};

/**
 * One raw suggestion against the household's rules and the pantry (D3/D4).
 * `ingredientMatches` lines up with `draft.ingredients` by construction:
 * `toRecipeDraft` maps the model's ingredients one to one, and a suggestion
 * where that ever failed to hold is dropped rather than shown misaligned.
 */
const evaluateSuggestion = (raw: RawSuggestion, index: number, pantry: readonly PantryItemRef[], rules: Rules, promptHash: string): Evaluation => {
  const draft = toRecipeDraft(raw);
  const filterable = toFilterable(raw);
  const violation = ruleViolation(filterable, rules);
  if (violation !== undefined) {
    return { dropped: violation };
  }
  const names = filterable.ingredients.map((i) => i.name);
  const grounded = groundSuggestion(names, pantry);
  if (!isGroundedEnough(grounded) || draft.ingredients.length !== names.length) {
    return { dropped: 'ungrounded' };
  }
  const warnings = [...draft.warnings, ...allergenWarnings(filterable, rules.allergens)];
  return {
    kept: {
      id: computeSuggestionId(promptHash, `${String(index)}:${raw.title}`),
      draft: { ...draft, warnings },
      ingredientMatches: grounded.ingredientMatches.map((match, i) => ({ ingredient: names[i] ?? '', ...match })),
      have: [...grounded.have],
      missing: [...grounded.missing],
    },
    ratio: haveRatio(grounded.ingredientMatches),
  };
};

/**
 * Skip list, dietary rules and grounding drop a suggestion; allergens only add a
 * warning; the best `PROMPT_LIMITS.suggestions` by have-ratio survive, ties in the
 * model's own order.
 */
const processSuggestions = (output: GeminiCookSuggestions, pantry: readonly PantryItemRef[], rules: Rules, promptHash: string): Processed => {
  const evaluations = output.suggestions.map((raw, index) => evaluateSuggestion(raw, index, pantry, rules, promptHash));
  const dropped = (reason: 'skip' | 'dietary' | 'ungrounded'): number => evaluations.filter((e) => 'dropped' in e && e.dropped === reason).length;
  const best = evaluations
    .flatMap((e, index) => ('kept' in e ? [{ result: e.kept, ratio: e.ratio, index }] : []))
    .sort((a, b) => b.ratio - a.ratio || a.index - b.index)
    .slice(0, PROMPT_LIMITS.suggestions);
  return {
    suggestions: best.map((entry) => entry.result),
    droppedSkip: dropped('skip'),
    droppedDietary: dropped('dietary'),
    droppedUngrounded: dropped('ungrounded'),
    meanHaveRatio: best.length === 0 ? 0 : best.reduce((sum, entry) => sum + entry.ratio, 0) / best.length,
  };
};

const safeEmit = (deps: CookFromPantryResolverDeps, summary: CookSummary): void => {
  try {
    (deps.emitMetric ?? ((s) => emitCookMetric(s)))(summary);
  } catch {
    // Metering must never fail a request the user already waited for.
  }
};

const NOTHING_PROCESSED: Processed = { suggestions: [], droppedSkip: 0, droppedDietary: 0, droppedUngrounded: 0, meanHaveRatio: 0 };

const summarize = (outcome: CookSummary['outcome'], cacheHit: boolean, latencyMs: number, processed: Processed = NOTHING_PROCESSED): CookSummary => ({
  cacheHit,
  outcome,
  suggestionsReturned: processed.suggestions.length,
  droppedSkip: processed.droppedSkip,
  droppedDietary: processed.droppedDietary,
  droppedUngrounded: processed.droppedUngrounded,
  meanHaveRatio: processed.meanHaveRatio,
  latencyMs,
});

const parseArgs = (raw: unknown): { householdId: string; vibe: CookVibe | null } => {
  const parsed = cookFromPantryArgsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input.');
  }
  return parsed.data;
};

interface ModelRequest {
  prompt: string;
  promptHash: string;
  householdId: string;
  cognitoSub: string;
  startedAt: number;
}

/** A cache read that fails is a miss: the quota call that follows uses the same table and would surface a real outage. Logged without content. */
const readCacheQuietly = (deps: CookFromPantryResolverDeps, request: ModelRequest): Promise<GeminiCookSuggestions | null> =>
  getCachedCookSuggestions(deps.getDdbClient(), deps.getCacheTableName(), request.householdId, request.promptHash).catch(() => {
    console.error('cookFromPantry: cache read failed');
    return null;
  });

/** What is left of the handler budget for the model, after the cache-write reserve, capped at the cook deadline. */
const modelBudgetMs = (deps: CookFromPantryResolverDeps, startedAt: number): number =>
  Math.min(COOK_DEADLINE_MS, HANDLER_BUDGET_MS - ((deps.nowMs ?? Date.now)() - startedAt) - CACHE_WRITE_RESERVE_MS);

/**
 * Cache, then the time budget, then the quota, then the model (D7). A hit costs
 * nothing; too little budget left is `AI_TIMEOUT` BEFORE any quota is spent. The
 * budget is measured again after the quota round trip, so a slow DynamoDB call
 * shortens the model's deadline instead of pushing the total past AppSync's ceiling.
 */
const obtainModelOutput = async (deps: CookFromPantryResolverDeps, request: ModelRequest): Promise<{ output: GeminiCookSuggestions; cacheHit: boolean }> => {
  const cached = await readCacheQuietly(deps, request);
  if (cached !== null) {
    return { output: cached, cacheHit: true };
  }
  if (modelBudgetMs(deps, request.startedAt) < MIN_MODEL_BUDGET_MS) {
    throw new AiTimeoutError();
  }
  await checkAndIncrementDailyAction(
    deps.getDdbClient(),
    deps.getCacheTableName(),
    COOK_ACTION,
    request.cognitoSub,
    MAX_COOK_REQUESTS_PER_DAY,
    `You've asked for ideas ${String(MAX_COOK_REQUESTS_PER_DAY)} times today — that's the daily limit. Your saved recipes are all still here.`,
    deps.now,
  );
  const deadlineMs = modelBudgetMs(deps, request.startedAt);
  if (deadlineMs < MIN_MODEL_BUDGET_MS) {
    throw new AiTimeoutError();
  }
  const output = await (deps.callModel ?? productionCallModel)(request.prompt, { deadlineMs, temperature: COOK_TEMPERATURE, maxOutputTokens: COOK_MAX_OUTPUT_TOKENS });
  return { output, cacheHit: false };
};

/** A cache-write failure, or one that hangs, must not lose (or delay past the ceiling) an answer the user already paid a model call for. Logged without content. */
const cacheQuietly = async (deps: CookFromPantryResolverDeps, request: ModelRequest, output: GeminiCookSuggestions): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const abandon = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CACHE_WRITE_TIMEOUT_MS);
  });
  const write = putCachedCookSuggestions(deps.getDdbClient(), deps.getCacheTableName(), request.householdId, request.promptHash, output, deps.now).catch(() => {
    console.error('cookFromPantry: cache write failed');
  });
  try {
    await Promise.race([write, abandon]);
  } finally {
    clearTimeout(timer);
  }
};

const execute = async (
  deps: CookFromPantryResolverDeps,
  event: AppSyncResolverEvent<{ householdId: unknown; vibe: unknown }>,
  startedAt: number,
): Promise<CookFromPantryResult> => {
  const nowMs = deps.nowMs ?? Date.now;
  const identity = extractCallerIdentity(event.identity);
  const { householdId, vibe } = parseArgs(event.arguments);

  const pool = await deps.getPool();
  const callerUser = await resolveCallerUser(pool, identity);
  const { pantry, settings } = await readHousehold(pool, callerUser.id, householdId);
  const rules = rulesFrom(settings);

  const finish = (outcome: CookResultOutcome, cacheHit: boolean, processed?: Processed): CookFromPantryResult => {
    safeEmit(deps, summarize(outcome, cacheHit, nowMs() - startedAt, processed));
    return { outcome, vibe, suggestions: processed === undefined ? [] : processed.suggestions };
  };

  if (isPantryTooSmall(pantry)) {
    return finish('pantry_too_small', false);
  }

  const selected = selectPromptPantryItems(pantry);
  const prompt = buildCookFromPantryPrompt({ pantry: selected.map((item) => item.name), vibe, ...rules });
  const promptHash = computePromptHash({ model: GEMINI_MODEL, temperature: COOK_TEMPERATURE, maxOutputTokens: COOK_MAX_OUTPUT_TOKENS, prompt });
  const request: ModelRequest = { prompt, promptHash, householdId, cognitoSub: identity.cognitoSub, startedAt };

  const { output, cacheHit } = await obtainModelOutput(deps, request);
  const processed = processSuggestions(output, selected, rules, promptHash);
  if (processed.suggestions.length === 0) {
    // Not cached: with temperature 0.6 this may just be a bad sample, and the dead-end screen steers the user to change the vibe.
    return finish('no_grounded_suggestions', cacheHit, processed);
  }
  if (!cacheHit) {
    await cacheQuietly(deps, request, output);
  }
  return finish('suggestions', cacheHit, processed);
};

/**
 * Direct-Lambda resolver for `Mutation.cookFromPantry` (W21 S3, `E2E_MVP_PLAN.md`
 * §28). Runs in the VPC's private-egress subnet: it needs Aurora (membership,
 * pantry, settings, under RLS) AND the internet (Gemini), the `staplesNoteFn` shape.
 *
 * The order of checks is D7's: cheapest and least committal first, so a
 * rejection, a non-member, a pantry too small to cook from, a cache hit and an
 * exhausted time budget all cost the user nothing. A call that fails still emits
 * its metric (`failed`), so failure rate and latency are measurable.
 */
export const createCookFromPantryHandler =
  (deps: CookFromPantryResolverDeps) =>
  async (event: AppSyncResolverEvent<{ householdId: unknown; vibe: unknown }>): Promise<CookFromPantryResult> => {
    const nowMs = deps.nowMs ?? Date.now;
    const startedAt = nowMs();
    try {
      return await execute(deps, event, startedAt);
    } catch (error) {
      safeEmit(deps, summarize('failed', false, nowMs() - startedAt));
      throw error;
    }
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported production handler.
export const handler = withErrorHandling(createCookFromPantryHandler(productionDeps));
