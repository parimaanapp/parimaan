import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';

/** SD §8.5's server-side ceiling; the client compresses to stay well under it (`pantry_photo_compression.dart`). */
export const MAX_PANTRY_PHOTO_BYTES = 500 * 1024;

export interface PantryPhotoObjectInfo {
  contentLength: number;
  contentType: string | undefined;
}

/**
 * The three S3 operations `analyzePantryPhoto` needs, behind an interface so
 * the resolver's ordering (validate -> rate-limit -> read -> analyze ->
 * delete) is testable without S3, and the real implementation's quirks are
 * tested once, here.
 */
export interface PantryPhotoStore {
  /** `null` when there is no such photo. */
  head: (key: string) => Promise<PantryPhotoObjectInfo | null>;
  /** Reads at most `maxBytes + 1` bytes — see `createS3PantryPhotoStore`. */
  getBytes: (key: string, maxBytes: number) => Promise<Uint8Array>;
  delete: (key: string) => Promise<void>;
}

const isMissingObject = (error: unknown): boolean => {
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404 || $metadata?.httpStatusCode === 403;
};

export const createS3PantryPhotoStore = (client: S3Client, bucket: string): PantryPhotoStore => ({
  async head(key) {
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { contentLength: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      // 403 as well as 404: without `s3:ListBucket` (which this Lambda's role
      // deliberately does not hold — least privilege) S3 answers 403, not 404,
      // for a key that does not exist. To this caller both mean "no such photo".
      if (isMissingObject(error)) return null;
      throw error;
    }
  },

  /**
   * A `Range` read capped at `maxBytes + 1`: a presigned PUT stays valid for
   * 5 minutes, so a caller could replace the object with a huge one between
   * the resolver's `HeadObject` size check and this read. Capping the read
   * bounds Lambda memory regardless; the caller treats a result longer than
   * `maxBytes` as oversize.
   */
  async getBytes(key, maxBytes) {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${String(maxBytes)}` }));
    if (result.Body === undefined) throw new Error(`Photo ${key} has no body.`);
    return result.Body.transformToByteArray();
  },

  async delete(key) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
});

/** JPEG start-of-image: FF D8 FF. Content-Type is client-supplied, so the bytes themselves are the check that counts. */
export const looksLikeJpeg = (bytes: Uint8Array): boolean => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
