import type { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { extractCallerIdentity } from '../auth/identity.js';
import { invokeModel, VISION_DEADLINE_MS } from '../ai/invokeModel.js';
import type { InvokeModelOptions } from '../ai/invokeModel.js';
import { emitPhotoAnalysisMetric } from '../ai/photoMetric.js';
import type { PhotoAnalysisSummary } from '../ai/photoMetric.js';
import { buildPantryPhotoPrompt, geminiPantryPhotoSchema, toPantryPhotoProposals } from '../ai/schemas/pantryPhotoProposal.js';
import type { GeminiPantryPhoto, PantryPhotoProposalResult } from '../ai/schemas/pantryPhotoProposal.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { loadUploadsBucketName } from '../uploads/config.js';
import { isOwnPantryPhotoKey } from '../uploads/pantryPhotoKey.js';
import { createS3PantryPhotoStore, looksLikeJpeg, MAX_PANTRY_PHOTO_BYTES } from '../uploads/pantryPhotoStore.js';
import type { PantryPhotoStore } from '../uploads/pantryPhotoStore.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/** SD §8.5. Consumed once per photo that reaches the model — never for one rejected as missing/oversize/not-a-JPEG. */
export const MAX_PHOTO_ANALYSES_PER_DAY = 20;
const PHOTO_ANALYSIS_ACTION = 'photoPantry';
/** Bounds output length, and with it latency and cost (W20 D2/D3; S1 measured p95 3.9s with this cap). */
const PHOTO_MAX_OUTPUT_TOKENS = 2048;

const argsSchema = z.object({ s3Key: z.string().min(1).max(300) });

export interface AnalyzePantryPhotoResolverDeps {
  getStore: () => PantryPhotoStore;
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  now?: () => Date;
  /** Seam for the vision call; production wires `invokeModel` with the pantry-photo schema. */
  invoke?: (prompt: string, options: InvokeModelOptions) => Promise<GeminiPantryPhoto>;
  emitMetric?: (summary: PhotoAnalysisSummary) => void;
  logError?: (message: string, error: unknown) => void;
}

let memoizedS3Client: S3Client | undefined;
let memoizedDdbClient: DynamoDBDocumentClient | undefined;

export const productionDeps: AnalyzePantryPhotoResolverDeps = {
  getStore: () => createS3PantryPhotoStore((memoizedS3Client ??= new S3Client({})), loadUploadsBucketName()),
  getDdbClient: () => (memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}))),
  getCacheTableName: () => loadCacheTableName(),
};

const productionInvoke = (prompt: string, options: InvokeModelOptions): Promise<GeminiPantryPhoto> =>
  invokeModel(prompt, geminiPantryPhotoSchema, options);

const defaultLogError = (message: string, error: unknown): void => {
  console.error(JSON.stringify({ message, error: error instanceof Error ? error.message : String(error) }));
};

/** Validates from `HeadObject` alone, before any bytes are read or any quota is spent. */
const assertAcceptableObject = (info: { contentLength: number; contentType: string | undefined }): void => {
  if (info.contentLength <= 0 || info.contentLength > MAX_PANTRY_PHOTO_BYTES || info.contentType !== 'image/jpeg') {
    throw new ValidationError('That photo could not be used. Please retake it.');
  }
};

/**
 * Direct-Lambda resolver for `Mutation.analyzePantryPhoto` (W20 S4,
 * `E2E_MVP_PLAN.md` §27). Order matters, and each step's position is
 * deliberate:
 *
 * 1. **Ownership, from the key alone** (D1) — before any S3 call, so another
 *    user's key is refused without S3 ever being touched.
 * 2. **`HeadObject`** — exists, ≤ 500KB, `image/jpeg`. A photo failing here
 *    costs the user nothing: no quota, no model call.
 * 3. **Daily limit** (D5) — consumed once, before the cost-bearing steps.
 * 4. **Capped read + magic-byte check** — the `Content-Type` is client-
 *    supplied, so the bytes are what actually gets checked; the `Range` cap
 *    bounds memory against an object swapped in after step 2.
 * 5. **Vision call** — `VISION_DEADLINE_MS`, output-capped, image-bearing.
 * 6. **Delete, in a `finally`** — the photo is removed whenever this
 *    resolver is done with it, on success or on any failure after step 2. A
 *    failed delete is logged, never surfaced: the bucket's 1-day lifecycle
 *    rule is the backstop, and failing a photo the user already waited for
 *    over a cleanup error would be the wrong trade.
 *
 * Nothing is persisted: the return value is an UNSAVED proposal, and the
 * pantry changes only when the user confirms through `bulkAddPantryItems`
 * (PRD §5.4 — "AI suggests, you approve").
 */
export const createAnalyzePantryPhotoHandler =
  (deps: AnalyzePantryPhotoResolverDeps) =>
  async (event: AppSyncResolverEvent<{ s3Key: unknown }>): Promise<PantryPhotoProposalResult> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = argsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { s3Key } = parsedArgs.data;

    if (!isOwnPantryPhotoKey(identity.cognitoSub, s3Key)) {
      throw new ForbiddenError('You can only analyze your own photos.');
    }

    const store = deps.getStore();
    const info = await store.head(s3Key);
    if (info === null) {
      throw new NotFoundError("We couldn't find that photo. Please retake it.");
    }

    try {
      assertAcceptableObject(info);

      await checkAndIncrementDailyAction(
        deps.getDdbClient(),
        deps.getCacheTableName(),
        PHOTO_ANALYSIS_ACTION,
        identity.cognitoSub,
        MAX_PHOTO_ANALYSES_PER_DAY,
        `You've reached today's limit of ${String(MAX_PHOTO_ANALYSES_PER_DAY)} photo analyses. Try again tomorrow.`,
        deps.now,
      );

      const bytes = await store.getBytes(s3Key, MAX_PANTRY_PHOTO_BYTES);
      if (bytes.length > MAX_PANTRY_PHOTO_BYTES || !looksLikeJpeg(bytes)) {
        throw new ValidationError('That photo could not be used. Please retake it.');
      }

      const started = Date.now();
      const raw = await (deps.invoke ?? productionInvoke)(buildPantryPhotoPrompt(), {
        deadlineMs: VISION_DEADLINE_MS,
        maxOutputTokens: PHOTO_MAX_OUTPUT_TOKENS,
        images: [{ mimeType: 'image/jpeg', base64Data: Buffer.from(bytes).toString('base64') }],
      });
      const result = toPantryPhotoProposals(raw);

      (deps.emitMetric ?? emitPhotoAnalysisMetric)({
        itemsProposed: result.items.length,
        itemsDropped: result.droppedCount,
        highConfidenceItems: result.items.filter((item) => item.confidence === 'high').length,
        truncated: result.truncated,
        latencyMs: Date.now() - started,
      });
      return result;
    } finally {
      await store.delete(s3Key).catch((error: unknown) => (deps.logError ?? defaultLogError)('Failed to delete pantry photo after analysis', error));
    }
  };

export const handler = withErrorHandling(createAnalyzePantryPhotoHandler(productionDeps));
