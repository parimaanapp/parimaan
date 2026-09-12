import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3Client as ProductionS3Client } from '@aws-sdk/client-s3';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember, DENIAL_MESSAGE } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findShoppingListById } from '../repositories/shoppingListRepository.js';
import { loadExportsBucketName } from '../exports/config.js';
import { presignShoppingListImageUpload } from '../exports/presignShoppingListImageUpload.js';
import { exportShoppingListImageArgsSchema } from '../validation/exportShoppingListImage.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface ExportShoppingListImageResolverDeps {
  getPool: () => Promise<Pool>;
  getBucketName: () => string;
  /** Injectable seam matching `staplesNoteFn.ts`'s own `getDdbClient` doc — a test supplies a dummy-credentialed client so presigning (a local computation, no network call) never touches real AWS. */
  getS3Client?: () => S3Client;
  /** Injectable clock — lets a test pin the `{timestamp}` segment of the generated key, and the presigned URL's signing instant, deterministically. */
  now?: () => Date;
}

let memoizedS3Client: S3Client | undefined;
const getProductionS3Client = (): S3Client => {
  memoizedS3Client ??= new ProductionS3Client({});
  return memoizedS3Client;
};

export const productionDeps: ExportShoppingListImageResolverDeps = {
  getPool,
  getBucketName: loadExportsBucketName,
  getS3Client: getProductionS3Client,
};

/**
 * Direct-Lambda resolver for `Mutation.exportShoppingListImage` (W17 S6,
 * `E2E_MVP_PLAN.md` §23.2.8, D8; confirmed absent server-side by §23.5's
 * own real-AWS pass). Returns a bare presigned S3 PUT URL (`String!`,
 * matching SD's own sketch exactly — never widened to `PresignedUpload!`,
 * per D8's own explicit rejection of that) for the caller to PUT a
 * client-rendered categorized shopping-list PNG to, outside GraphQL
 * entirely.
 *
 * Resolves the list's household via `findShoppingListById` (an id-only,
 * no-RLS-join lookup — `shopping_lists` carries its own `household_id`
 * directly, unlike `shopping_list_items`, so no parent-join is needed the
 * way `findShoppingListItemForHaveIt` needs one) and gates with
 * `requireHouseholdMember` — the SAME two-step "resolve household from the
 * one id the caller sent, then gate" shape `haveIt`/`markPurchased` use for
 * their own `itemId`-only arguments. A nonexistent `listId` and a real one
 * in another household both throw the byte-identical `ForbiddenError`/
 * `DENIAL_MESSAGE` — never an existence oracle.
 *
 * No write happens here at all — this resolver only presigns a URL; the
 * actual upload is the caller's own, separate, fire-and-forget HTTP PUT
 * (D8). `withUserTransaction` is used anyway (read-only) purely so
 * `findShoppingListById`/`requireHouseholdMember` run under the same RLS
 * session-variable convention every other resolver in this codebase uses
 * for ANY Aurora read — a bare `pool.connect()` would bypass layer-3 RLS
 * entirely on `shopping_lists`, the SAME defense-in-depth reasoning
 * `markPurchased.ts`'s own doc already states.
 */
export const createExportShoppingListImageHandler =
  (deps: ExportShoppingListImageResolverDeps) =>
  async (event: AppSyncResolverEvent<{ listId: unknown }>): Promise<string> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = exportShoppingListImageArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { listId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    const householdId = await withUserTransaction(
      callerUser.id,
      async (client) => {
        const list = await findShoppingListById(client, listId);
        if (list === null) {
          throw new ForbiddenError(DENIAL_MESSAGE);
        }
        await requireHouseholdMember(client, callerUser.id, list.householdId);
        return list.householdId;
      },
      pool,
    );

    const bucketName = deps.getBucketName();
    const now = deps.now?.() ?? new Date();
    const s3Client = deps.getS3Client?.() ?? getProductionS3Client();
    return presignShoppingListImageUpload(s3Client, bucketName, householdId, listId, now);
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createExportShoppingListImageHandler`'s returned
// function.
export const handler = withErrorHandling(createExportShoppingListImageHandler(productionDeps));
