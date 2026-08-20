import { z } from 'zod';

/**
 * `process.env` boundary for the DynamoDB cache/rate-limit table name — same
 * fail-loudly-at-cold-start convention as `db/config.ts`'s `loadDbConfig`.
 * `infra/stacks/data-stack.ts`'s `DataStack.cacheTable` is wired to the
 * `joinHousehold` Lambda's `CACHE_TABLE_NAME` env var separately (infra
 * wiring is out of scope for this slice — see the API resolver's own
 * comment on this).
 */
const envSchema = z.object({
  CACHE_TABLE_NAME: z.string().min(1, 'CACHE_TABLE_NAME must be set'),
});

export const loadCacheTableName = (env: Record<string, string | undefined> = process.env): string =>
  envSchema.parse(env).CACHE_TABLE_NAME;
