import 'server-only';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/**
 * `import 'server-only'` — see `secrets.ts`'s identical comment. This
 * module fetches `NEXTAUTH_SECRET_ARN` (`frontend-stack.ts`'s env var,
 * pointing at a plain-random-string Secrets Manager secret, a same-week
 * follow-up fix closing a gap W18 S3 flagged rather than invented fresh —
 * NextAuth's JWT session strategy needs a stable signing/encryption secret
 * across every warm instance, not an ephemeral per-instance one).
 */

const requireEnv = (name: string, env: Record<string, string | undefined>): string => {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

/**
 * Fetches the raw `SecretString` for `NEXTAUTH_SECRET_ARN`. Mirrors
 * `secrets.ts`'s `fetchWebClientCredentialsSecretString` shape exactly —
 * same client, same "throw if `SecretString` is missing" check — except
 * this secret is a plain random string, not a JSON envelope, so the
 * fetched value IS the secret, with no parse step.
 */
const fetchNextAuthSecretString = async (env: Record<string, string | undefined>): Promise<string> => {
  const secretArn = requireEnv('NEXTAUTH_SECRET_ARN', env);
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (result.SecretString === undefined) {
    throw new Error(`Secret ${secretArn} has no SecretString value.`);
  }
  return result.SecretString;
};

export interface NextAuthSecretDeps {
  /** Defaults to `process.env`. Overridable for tests. */
  env?: Record<string, string | undefined>;
  /** Defaults to fetching from Secrets Manager. Overridable for tests — never hits AWS. */
  fetchSecretString?: (env: Record<string, string | undefined>) => Promise<string>;
}

/**
 * Module-scope memoized secret promise — same "fetch once per warm
 * instance" discipline as `secrets.ts`'s `credentialsPromise`.
 */
let secretPromise: Promise<string> | undefined;

/**
 * Fetches NextAuth's session signing/encryption secret. Never called from
 * a `'use client'` file — see the `server-only` import above.
 */
export const getNextAuthSecret = async (deps: NextAuthSecretDeps = {}): Promise<string> => {
  secretPromise ??= (async () => {
    const env = deps.env ?? process.env;
    return (deps.fetchSecretString ?? fetchNextAuthSecretString)(env);
  })();
  return secretPromise;
};

/** Test-only: clears the memoized secret so the next call fetches fresh. */
export const resetNextAuthSecretForTesting = (): void => {
  secretPromise = undefined;
};
