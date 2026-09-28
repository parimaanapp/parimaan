import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { buildPantryPhotoKey } from './pantryPhotoKey.js';

/** 5 minutes (W20 D4) — long enough for a slow mobile upload of a ≤500KB JPEG, short enough that a leaked URL is nearly worthless. */
export const PANTRY_PHOTO_PRESIGN_EXPIRY_SECONDS = 5 * 60;

export interface PresignedPantryPhotoUpload {
  url: string;
  s3Key: string;
  /** ISO-8601 UTC — an AppSync `AWSDateTime`. */
  expiresAt: string;
}

/**
 * Presigns a PUT for one new caller-scoped photo key. `ContentType` is part
 * of the signature, so the URL only accepts `image/jpeg` — a presigned PUT
 * cannot enforce SIZE (S3 has no content-length-range on PUT), which is why
 * `analyzePantryPhoto` (S4) re-checks `ContentLength` with a `HeadObject`
 * before reading anything, and why the bucket's 1-day lifecycle rule
 * exists as the backstop for anything never analyzed.
 */
export const presignPantryPhotoUpload = async (
  s3Client: S3Client,
  bucketName: string,
  cognitoSub: string,
  objectId: string,
  now: Date,
): Promise<PresignedPantryPhotoUpload> => {
  const s3Key = buildPantryPhotoKey(cognitoSub, objectId);
  const command = new PutObjectCommand({ Bucket: bucketName, Key: s3Key, ContentType: 'image/jpeg' });
  const url = await getSignedUrl(s3Client, command, {
    expiresIn: PANTRY_PHOTO_PRESIGN_EXPIRY_SECONDS,
    signingDate: now,
    signableHeaders: new Set(['content-type']),
  });
  return { url, s3Key, expiresAt: new Date(now.getTime() + PANTRY_PHOTO_PRESIGN_EXPIRY_SECONDS * 1000).toISOString() };
};
