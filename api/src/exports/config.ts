import { z } from 'zod';

/**
 * `process.env` boundary for the exports S3 bucket name — same
 * fail-loudly-at-cold-start convention as `rateLimit/config.ts`'s
 * `loadCacheTableName`/`db/config.ts`'s `loadDbConfig`.
 * `infra/stacks/data-stack.ts`'s `DataStack.exportsBucket` is wired to
 * `ExportShoppingListImageFn`'s `EXPORTS_BUCKET_NAME` env var in
 * `infra/stacks/api-stack.ts` — infra wiring is a separate concern from
 * this resolver reading it back out.
 */
const envSchema = z.object({
  EXPORTS_BUCKET_NAME: z.string().min(1, 'EXPORTS_BUCKET_NAME must be set'),
});

export const loadExportsBucketName = (env: Record<string, string | undefined> = process.env): string =>
  envSchema.parse(env).EXPORTS_BUCKET_NAME;
