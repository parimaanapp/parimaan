import { z } from 'zod';

/**
 * `process.env` is an untrusted boundary (coding-style rule: validate at
 * system boundaries) — every var below is required for this Lambda's
 * `parimaan_app`-role Postgres connection (see `db/pool.ts`), and a missing
 * or malformed one should fail loudly and specifically at cold start, not
 * several calls deep into a `Pool` constructor with `undefined` fields.
 * Modeled on `migrationRunner/loadProductionDeps.ts`'s `requireEnvVar`
 * pattern, but expressed as a single Zod schema instead of one check per
 * var.
 */
const envSchema = z.object({
  // No DB_SECRET_ARN here, deliberately: these resolver Lambdas connect to
  // Aurora as the least-privileged `parimaan_app` role only, and must never
  // reference the cluster's admin-credentials secret — `infra/stacks/
  // api-stack.ts` doesn't set this env var on them at all (confirmed by
  // its own test asserting DB_SECRET_ARN is absent). Requiring it here
  // would make every cold start throw in real AWS.
  APP_ROLE_SECRET_ARN: z.string().min(1, 'APP_ROLE_SECRET_ARN must be set'),
  DB_HOST: z.string().min(1, 'DB_HOST must be set'),
  DB_PORT: z.coerce
    .number({ error: 'DB_PORT must be a valid integer' })
    .int('DB_PORT must be a valid integer')
    .positive('DB_PORT must be a valid integer'),
  DB_NAME: z.string().min(1, 'DB_NAME must be set'),
});

export interface DbConfig {
  appRoleSecretArn: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
}

/**
 * Parses and validates the env vars this package's Postgres-connecting
 * Lambdas (`me`, `userHouseholds`, `createHousehold`) need. Throws a
 * `ZodError` naming exactly which var is missing/invalid — `env` defaults to
 * `process.env` but is overridable for tests.
 */
export const loadDbConfig = (env: Record<string, string | undefined> = process.env): DbConfig => {
  const parsed = envSchema.parse(env);
  return {
    appRoleSecretArn: parsed.APP_ROLE_SECRET_ARN,
    dbHost: parsed.DB_HOST,
    dbPort: parsed.DB_PORT,
    dbName: parsed.DB_NAME,
  };
};
