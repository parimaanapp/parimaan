import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Pool } from 'pg';
import type { DbConfig } from './config.js';
import { loadDbConfig } from './config.js';
import { RDS_GLOBAL_BUNDLE_CA } from './rdsGlobalBundleCa.js';

const APP_ROLE_USER = 'parimaan_app';

interface AppRoleSecretJson {
  password: string;
}

const isAppRoleSecretJson = (value: unknown): value is AppRoleSecretJson =>
  typeof value === 'object' &&
  value !== null &&
  'password' in value &&
  typeof (value as { password: unknown }).password === 'string';

/**
 * Fetches the `parimaan_app` role's password from the Secrets Manager
 * secret `DataStack.appRoleSecret` already creates (consumed here, not
 * created here) — same fetch-and-narrow pattern as
 * `migrationRunner/loadProductionDeps.ts`'s `fetchAppRolePassword`.
 */
const fetchAppRolePasswordFromSecretsManager = async (appRoleSecretArn: string): Promise<string> => {
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: appRoleSecretArn }));
  if (result.SecretString === undefined) {
    throw new Error(`Secret ${appRoleSecretArn} has no SecretString value.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.SecretString);
  } catch (cause) {
    throw new Error(`Secret ${appRoleSecretArn} does not contain valid JSON.`, { cause });
  }

  if (!isAppRoleSecretJson(parsed)) {
    throw new Error(`Secret ${appRoleSecretArn} does not have the expected shape.`);
  }
  return parsed.password;
};

export interface GetPoolOptions {
  /** Defaults to `loadDbConfig()` (real `process.env`). Overridable for tests. */
  config?: DbConfig;
  /** Defaults to fetching from Secrets Manager. Overridable for tests. */
  fetchAppRolePassword?: (appRoleSecretArn: string) => Promise<string>;
}

/**
 * Module-scope memoized pool promise. A single Lambda execution environment
 * reuses this module across warm invocations — memoizing here (rather than
 * inside `getPool`'s body unconditionally constructing a new `Pool`) is what
 * makes connection reuse across invocations possible at all.
 */
let poolPromise: Promise<Pool> | undefined;

const buildPool = async (options: GetPoolOptions): Promise<Pool> => {
  const config = options.config ?? loadDbConfig();
  const fetchAppRolePassword = options.fetchAppRolePassword ?? fetchAppRolePasswordFromSecretsManager;
  const password = await fetchAppRolePassword(config.appRoleSecretArn);

  const pool = new Pool({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: APP_ROLE_USER,
    password,
    // `ca` is not optional here: without it, Node has no way to verify
    // Amazon's RDS-issued server certificate against `rejectUnauthorized:
    // true`, and every connection fails with `unable to get local issuer
    // certificate` — see `rdsGlobalBundleCa.ts`'s doc.
    ssl: { rejectUnauthorized: true, ca: RDS_GLOBAL_BUNDLE_CA },
    max: 2,
    idleTimeoutMillis: 10_000,
    // Aurora Serverless v2's auto-pause resume can take up to ~30s (the
    // mobile app's own cold-start copy promises exactly that) — 5s here
    // reliably timed out on every genuine cold start well before the
    // resolver Lambda's own 45s function timeout (`api-stack.ts`'s
    // `createDbResolverFunction`) ever became the limiting factor. Left
    // below that function timeout so the pool times out first, with a real
    // `Error: Connection terminated due to connection timeout` a resolver
    // can log — a bare Lambda timeout kill gives no such message.
    connectionTimeoutMillis: 35_000,
    allowExitOnIdle: true,
  });

  // An unhandled 'error' event on an idle client crashes the Node process
  // (per `pg`'s own docs) — this is a background/idle-connection error, not
  // a query error (those reject their own query promise). Logging here
  // (rather than leaving unhandled) keeps a single flaky backend connection
  // from taking down the whole Lambda execution environment.
  pool.on('error', (err: Error) => {
    console.error('Unexpected idle Postgres client error', err);
  });

  return pool;
};

/**
 * Returns the memoized `parimaan_app`-role connection pool, building it on
 * first call. Every resolver Lambda in this slice calls this rather than
 * constructing its own `Pool`, so warm invocations reuse connections instead
 * of exhausting the (proxy-less) database's connection limit.
 */
export const getPool = async (options: GetPoolOptions = {}): Promise<Pool> => {
  poolPromise ??= buildPool(options);
  return poolPromise;
};

/**
 * Ends the memoized pool and clears the memoization so the next `getPool`
 * call builds a fresh one. Test-only — a warm Lambda execution environment
 * has no equivalent teardown point in production.
 */
export const resetPoolForTesting = async (): Promise<void> => {
  const existing = await poolPromise;
  poolPromise = undefined;
  if (existing) {
    await existing.end();
  }
};
