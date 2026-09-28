import { randomUUID } from 'node:crypto';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3Client as ProductionS3Client } from '@aws-sdk/client-s3';
import { extractCallerIdentity } from '../auth/identity.js';
import { loadCacheTableName } from '../rateLimit/config.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { loadUploadsBucketName } from '../uploads/config.js';
import { presignPantryPhotoUpload } from '../uploads/presignPantryPhotoUpload.js';
import type { PresignedPantryPhotoUpload } from '../uploads/presignPantryPhotoUpload.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * 3x `analyzePantryPhoto`'s own 20/day (SD §8.5): a retake, or a PUT that
 * failed and needs a fresh URL, costs a URL but no AI call. The cap exists
 * so the uploads bucket can't be used as free storage by an authenticated
 * account, not to ration the feature — that is the analyze limit's job.
 */
export const MAX_PHOTO_UPLOAD_URLS_PER_DAY = 60;
const PHOTO_UPLOAD_URL_ACTION = 'photoPantryUrl';

export interface GetPantryPhotoUploadUrlResolverDeps {
  getBucketName: () => string;
  getS3Client?: () => S3Client;
  getDdbClient: () => DynamoDBDocumentClient;
  getCacheTableName: () => string;
  now?: () => Date;
  /** Injectable so a test can pin the object id; production uses `randomUUID`. */
  newObjectId?: () => string;
}

let memoizedS3Client: S3Client | undefined;
const getProductionS3Client = (): S3Client => {
  memoizedS3Client ??= new ProductionS3Client({});
  return memoizedS3Client;
};

let memoizedDdbClient: DynamoDBDocumentClient | undefined;
const getProductionDdbClient = (): DynamoDBDocumentClient => {
  memoizedDdbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return memoizedDdbClient;
};

export const productionDeps: GetPantryPhotoUploadUrlResolverDeps = {
  getBucketName: () => loadUploadsBucketName(),
  getS3Client: getProductionS3Client,
  getDdbClient: getProductionDdbClient,
  getCacheTableName: () => loadCacheTableName(),
};

/**
 * Direct-Lambda resolver for `Mutation.getPantryPhotoUploadUrl` (W20 S3,
 * `E2E_MVP_PLAN.md` §27). Takes NO arguments — the key is scoped to the
 * caller's own Cognito sub (D1), so this non-VPC Lambda needs no household
 * and no database. Rate-limits first (cheap, and it means an over-limit
 * caller never even gets a signed URL), then presigns.
 *
 * No write happens here: the upload is the client's own, separate HTTP PUT
 * (as `exportShoppingListImage`'s is), outside GraphQL entirely.
 */
export const createGetPantryPhotoUploadUrlHandler =
  (deps: GetPantryPhotoUploadUrlResolverDeps) =>
  async (event: AppSyncResolverEvent<Record<string, never>>): Promise<PresignedPantryPhotoUpload> => {
    const identity = extractCallerIdentity(event.identity);
    const now = (deps.now ?? (() => new Date()))();

    await checkAndIncrementDailyAction(
      deps.getDdbClient(),
      deps.getCacheTableName(),
      PHOTO_UPLOAD_URL_ACTION,
      identity.cognitoSub,
      MAX_PHOTO_UPLOAD_URLS_PER_DAY,
      `You've reached today's limit of ${String(MAX_PHOTO_UPLOAD_URLS_PER_DAY)} photo uploads. Try again tomorrow.`,
      deps.now,
    );

    return presignPantryPhotoUpload(
      (deps.getS3Client ?? getProductionS3Client)(),
      deps.getBucketName(),
      identity.cognitoSub,
      (deps.newObjectId ?? randomUUID)(),
      now,
    );
  };

export const handler = withErrorHandling(createGetPantryPhotoUploadUrlHandler(productionDeps));
