import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { runMigrations } from '../db/runMigrations.js';
import type { DbAdminCredentials, MigrationRunnerDeps } from './types.js';

interface AppRoleSecretJson {
  password: string;
}

interface DbAdminSecretJson extends AppRoleSecretJson {
  username: string;
}

/**
 * Reads a required env var, throwing an error that names the missing
 * variable rather than letting a later step fail with a cryptic downstream
 * error (e.g. `new SecretsManagerClient({}).send(...)` failing because
 * `secretArn` was `undefined`).
 */
const requireEnvVar = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set in the environment for the migration runner Lambda.`);
  }
  return value;
};

/**
 * Fetches and parses a Secrets Manager secret's JSON value, then narrows it
 * with `isShapeValid` before returning it as `T`. The secret is
 * self-controlled (created by this same CDK stack via
 * `Credentials.fromGeneratedSecret`/`generateSecretString`), not
 * third-party/user input, so a shape mismatch here means the deployment
 * itself is misconfigured — this is meant to fail loud with a message
 * naming the secret ARN, rather than an unparseable-JSON `SyntaxError` or
 * an `undefined.length` crash several lines further into the handler.
 */
const fetchSecretJson = async <T>(
  client: SecretsManagerClient,
  secretArn: string,
  isShapeValid: (value: unknown) => value is T,
): Promise<T> => {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (result.SecretString === undefined) {
    throw new Error(`Secret ${secretArn} has no SecretString value.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.SecretString);
  } catch (cause) {
    throw new Error(`Secret ${secretArn} does not contain valid JSON.`, { cause });
  }

  if (!isShapeValid(parsed)) {
    throw new Error(`Secret ${secretArn} does not have the expected shape.`);
  }
  return parsed;
};

const isAppRoleSecretJson = (value: unknown): value is AppRoleSecretJson =>
  typeof value === 'object' &&
  value !== null &&
  'password' in value &&
  typeof (value as { password: unknown }).password === 'string';

const isDbAdminSecretJson = (value: unknown): value is DbAdminSecretJson =>
  isAppRoleSecretJson(value) &&
  'username' in value &&
  typeof (value as { username: unknown }).username === 'string';

/**
 * Builds the migration-runner Lambda's real, AWS-backed dependencies from
 * environment variables set by the CDK stack that deploys it. Every required
 * var is validated eagerly here (not lazily inside the fetch functions) so a
 * misconfigured deployment fails fast, at handler-construction time, with a
 * message naming exactly which var is missing.
 */
export const loadProductionDeps = (): MigrationRunnerDeps => {
  const dbSecretArn = requireEnvVar('DB_SECRET_ARN');
  const appRoleSecretArn = requireEnvVar('APP_ROLE_SECRET_ARN');
  const dbHost = requireEnvVar('DB_HOST');
  const dbPort = requireEnvVar('DB_PORT');
  const dbName = requireEnvVar('DB_NAME');
  // Optional, unlike the vars above: only set by the CDK stack's bundling
  // step, which copies `api/migrations/` into the deployed asset at a
  // location that doesn't match `runMigrations.ts`'s own source-relative
  // default. Absent when this handler runs from source (tests, local
  // invocation), where that default is correct.
  const migrationsDirOverride = process.env['MIGRATIONS_DIR'];

  const secretsClient = new SecretsManagerClient({});

  const fetchDbAdminCredentials = async (): Promise<DbAdminCredentials> =>
    fetchSecretJson(secretsClient, dbSecretArn, isDbAdminSecretJson);

  const fetchAppRolePassword = async (): Promise<string> => {
    const secret = await fetchSecretJson(secretsClient, appRoleSecretArn, isAppRoleSecretJson);
    return secret.password;
  };

  return {
    fetchDbAdminCredentials,
    fetchAppRolePassword,
    runMigrations,
    dbHost,
    dbPort: Number(dbPort),
    dbName,
    ...(migrationsDirOverride ? { migrationsDirOverride } : {}),
  };
};
