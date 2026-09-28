import { z } from 'zod';

const envSchema = z.object({
  UPLOADS_BUCKET_NAME: z.string().min(1, 'UPLOADS_BUCKET_NAME must be set'),
});

/** Same fail-loudly-at-cold-start shape as `exports/config.ts`'s `loadExportsBucketName`. */
export const loadUploadsBucketName = (env: Record<string, string | undefined> = process.env): string =>
  envSchema.parse(env).UPLOADS_BUCKET_NAME;
