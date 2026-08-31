import type { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { extractCallerIdentity } from '../auth/identity.js';
import { fetchPage } from '../net/fetchPage.js';
import { parseJsonLdRecipe } from '../domain/jsonLd/normalise.js';
import type { JsonLdRecipeDraft } from '../domain/jsonLd/normalise.js';
import type { RecipeDraftResult } from '../ai/schemas/recipeDraft.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { importRecipeFromUrlArgsSchema } from '../validation/importRecipeFromUrl.js';
import { UrlUnreadableError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/** `'urlImport'` at 30/day per user (§13.2.9 D8) — frozen production data once deployed, same convention as every other `dailyActionLimiter.ts` action name. */
export const MAX_URL_IMPORTS_PER_DAY = 30;
const URL_IMPORT_ACTION = 'urlImport';

export interface ImportRecipeFromUrlResolverDeps {
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  /** Injectable clock for the rate limiter's UTC-day bucketing — see `dailyActionLimiter.ts`. */
  now?: () => Date;
  /**
   * Injectable seam over `fetchPage` — defaults to the real SSRF-safe
   * fetcher. Tests inject a stub so this resolver's own tests (identity,
   * validation, rate limiting, `RecipeDraft` mapping) don't need a real
   * network call or a real DNS lookup, which `net/safeUrl.test.ts` and
   * `net/fetchPage.test.ts` already cover fully and independently at
   * their own layer.
   */
  fetchPage?: (url: string) => Promise<string | null>;
}

let memoizedDdbClient: DynamoDBDocumentClient | undefined;
const getProductionDdbClient = (): DynamoDBDocumentClient => {
  memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return memoizedDdbClient;
};

const productionFetchPage = (url: string): Promise<string | null> => fetchPage(url);

export const productionDeps: ImportRecipeFromUrlResolverDeps = {
  getDdbClient: getProductionDdbClient,
  getCacheTableName: () => loadCacheTableName(),
  fetchPage: productionFetchPage,
};

/** Maps S4's `JsonLdRecipeDraft` (no `cuisineTier1`/`role`/`dietaryTags` — neither JSON-LD nor a Gemini parse produces those reliably, §13.2.3's own note) into the full `RecipeDraft` shape, with `sourceUrl` set to the confirmed, already-validated URL. */
const toRecipeDraftResult = (draft: JsonLdRecipeDraft, sourceUrl: string): RecipeDraftResult => ({
  title: draft.title,
  description: draft.description,
  servings: draft.servings,
  prepMin: draft.prepMin,
  cookMin: draft.cookMin,
  cuisineTier1: null,
  cuisineTier2: null,
  dietaryTags: [],
  role: null,
  ingredients: draft.ingredients,
  steps: draft.steps,
  sourceUrl,
  warnings: draft.warnings,
});

/**
 * Direct-Lambda resolver for `Mutation.importRecipeFromUrl`. Same non-VPC,
 * no-`householdId`, rate-limit-keyed-on-`cognitoSub` shape as
 * `parseFreeformRecipe` (S3) and the identical reasoning (§13.2.1 D3):
 * this Lambda has no route to Aurora, so it cannot run
 * `requireHouseholdMember`.
 *
 * Order matters and is deliberate: validate identity → validate `{ url }`
 * (`VALIDATION`, cheapest check first) → check the daily cap
 * (`RateLimitedError`, still before any DNS lookup — §13.2.10's own named
 * RED test) → fetch the page exactly once (the full SSRF gate lives in
 * `net/fetchPage.ts`/`net/safeUrl.ts`, re-run on every redirect hop) →
 * parse it (S4's pure JSON-LD module). A fetch failure and a "no usable
 * recipe found" parse failure are BOTH mapped to the identical
 * `UrlUnreadableError` — never distinguished, matching `fetchPage`'s own
 * "never an oracle" contract.
 */
export const createImportRecipeFromUrlHandler =
  (deps: ImportRecipeFromUrlResolverDeps) =>
  async (event: AppSyncResolverEvent<{ url: unknown }>): Promise<RecipeDraftResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = importRecipeFromUrlArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { url } = parsedArgs.data;

    await checkAndIncrementDailyAction(
      deps.getDdbClient(),
      deps.getCacheTableName(),
      URL_IMPORT_ACTION,
      identity.cognitoSub,
      MAX_URL_IMPORTS_PER_DAY,
      `You've reached today's limit of ${MAX_URL_IMPORTS_PER_DAY} recipe imports. Try again tomorrow.`,
      deps.now,
    );

    const fetchPageImpl = deps.fetchPage ?? productionFetchPage;
    const html = await fetchPageImpl(url);
    if (html === null) {
      throw new UrlUnreadableError();
    }

    const draft = parseJsonLdRecipe(html);
    if (draft === null) {
      throw new UrlUnreadableError();
    }

    return toRecipeDraftResult(draft, url);
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createImportRecipeFromUrlHandler`'s returned function.
export const handler = withErrorHandling(createImportRecipeFromUrlHandler(productionDeps));
