import type { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { buildParseFreeformRecipePrompt } from '../../prompts/parseFreeformRecipe.js';
import { extractCallerIdentity } from '../auth/identity.js';
import { invokeModel } from '../ai/invokeModel.js';
import { geminiRecipeDraftSchema, toRecipeDraft } from '../ai/schemas/recipeDraft.js';
import type { GeminiRecipeDraft, RecipeDraftResult } from '../ai/schemas/recipeDraft.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { parseFreeformRecipeArgsSchema } from '../validation/parseFreeformRecipe.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * `'freeformParse'` at 20/day per user (SD §8.5, W7 D8 §13.2.9) — this
 * codebase's DynamoDB rate-limit action names are frozen production data
 * once deployed (`rateLimit/dailyActionLimiter.ts`'s own doc), so this is
 * not a cosmetic label.
 */
export const MAX_FREEFORM_PARSES_PER_DAY = 20;
const FREEFORM_PARSE_ACTION = 'freeformParse';

export interface ParseFreeformRecipeResolverDeps {
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  /** Injectable clock for the rate limiter's UTC-day bucketing — see `dailyActionLimiter.ts`. */
  now?: () => Date;
  /**
   * Injectable seam over `invokeModel` — defaults to the real Gemini-backed
   * call. Tests inject a stub so this resolver's own tests (identity,
   * validation, rate limiting, `RecipeDraft` mapping) don't need to
   * simulate Gemini's transport/retry chain, which `ai/invokeModel.test.ts`
   * already covers fully and independently at its own layer.
   */
  parseWithModel?: (prompt: string) => Promise<GeminiRecipeDraft>;
}

let memoizedDdbClient: DynamoDBDocumentClient | undefined;
const getProductionDdbClient = (): DynamoDBDocumentClient => {
  memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return memoizedDdbClient;
};

/**
 * The real implementation, typed non-optionally so the resolver's own
 * fallback below (`deps.parseWithModel ?? productionParseWithModel`) is
 * type-checked, not asserted through `productionDeps.parseWithModel!`
 * (flagged by `typescript-reviewer`: that `!` silenced a check the type
 * system would otherwise correctly enforce, and nothing guaranteed
 * `productionDeps`'s own optional field stayed populated across a future
 * refactor).
 */
const productionParseWithModel = (prompt: string): Promise<GeminiRecipeDraft> => invokeModel(prompt, geminiRecipeDraftSchema);

export const productionDeps: ParseFreeformRecipeResolverDeps = {
  getDdbClient: getProductionDdbClient,
  getCacheTableName: () => loadCacheTableName(),
  parseWithModel: productionParseWithModel,
};

/**
 * Direct-Lambda resolver for `Mutation.parseFreeformRecipe`. Runs on the
 * non-VPC resolver category (S2, D3): no Aurora access, so no
 * `requireHouseholdMember` and no `householdId` argument to gate on — the
 * caller is a verified Cognito principal and nothing more, and the rate
 * limit below is keyed on `cognitoSub` directly rather than a Postgres
 * `users.id` lookup this Lambda has no route to perform (§13.2.1's own
 * "keyed on the Cognito sub alone" rationale).
 *
 * Order matters and is deliberate, cheapest-and-least-committal first:
 * validate identity → validate `{ text }` (`VALIDATION`, no Gemini call,
 * no rate-limit token spent on input the server was always going to
 * reject) → check the daily cap (`RateLimitedError`, still no Gemini
 * call) → call the model exactly once → map the model's response to a
 * `RecipeDraft`. The rate limit is consumed exactly once here, before
 * `parseWithModel`'s single call — `invokeModel`'s own internal transport/
 * reinforcement retries (§13.2.7) never touch this counter again, so a
 * throttled or retried call still only costs the user one of their 20
 * daily parses (§13.2.9).
 */
export const createParseFreeformRecipeHandler =
  (deps: ParseFreeformRecipeResolverDeps) =>
  async (event: AppSyncResolverEvent<{ text: unknown }>): Promise<RecipeDraftResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = parseFreeformRecipeArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { text } = parsedArgs.data;

    await checkAndIncrementDailyAction(
      deps.getDdbClient(),
      deps.getCacheTableName(),
      FREEFORM_PARSE_ACTION,
      identity.cognitoSub,
      MAX_FREEFORM_PARSES_PER_DAY,
      `You've reached today's limit of ${MAX_FREEFORM_PARSES_PER_DAY} recipe parses. Try again tomorrow.`,
      deps.now,
    );

    const parseWithModel = deps.parseWithModel ?? productionParseWithModel;
    const rawDraft = await parseWithModel(buildParseFreeformRecipePrompt(text));
    return toRecipeDraft(rawDraft);
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createParseFreeformRecipeHandler`'s returned function.
export const handler = withErrorHandling(createParseFreeformRecipeHandler(productionDeps));
