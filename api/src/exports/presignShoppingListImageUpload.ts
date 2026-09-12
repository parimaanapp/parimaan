import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * D8's locked expiry (E2E_MVP_PLAN.md §23.2.8) — comfortably enough for an
 * immediate client-side upload, tight enough to bound the window a leaked
 * URL is exploitable.
 */
export const EXPORT_PRESIGN_EXPIRY_SECONDS = 10 * 60;

/**
 * D8's locked key convention (E2E_MVP_PLAN.md §23.2.8) —
 * `exports/{householdId}/{listId}/{timestamp}.png`. `timestamp` is epoch
 * milliseconds (`now().getTime()`), which is sortable and collision-safe
 * enough for a backup export key — this is a write-once-never-looked-up
 * object (D8's own "uploads once, immediately, and never needs to
 * reference the object again" framing), not an id anything else joins
 * against.
 */
export const buildExportShoppingListImageKey = (householdId: string, listId: string, now: Date): string =>
  `exports/${householdId}/${listId}/${now.getTime()}.png`;

/**
 * Presigns a PUT against `bucketName` for `householdId`/`listId`'s export
 * key (D8, E2E_MVP_PLAN.md §23.2.8) — the one place this resolver actually
 * talks to S3, extracted out of `exportShoppingListImage.ts` so it's
 * directly unit-testable (and mockable) without a real S3 client in the
 * resolver's own test suite.
 */
export const presignShoppingListImageUpload = async (
  s3Client: S3Client,
  bucketName: string,
  householdId: string,
  listId: string,
  now: Date,
): Promise<string> => {
  const key = buildExportShoppingListImageKey(householdId, listId, now);
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: 'image/png',
  });
  // `signingDate: now` anchors the presigned URL's own `X-Amz-Date`/expiry
  // math to the SAME clock the key's `{timestamp}` segment used, rather
  // than a second, independent call to the real system clock a moment
  // later — makes "signed at generation time" an exact, testable claim
  // instead of an approximate one.
  return getSignedUrl(s3Client, command, { expiresIn: EXPORT_PRESIGN_EXPIRY_SECONDS, signingDate: now });
};
