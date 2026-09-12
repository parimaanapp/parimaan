import 'server-only';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';

/**
 * `import 'server-only'` (top of file, above) makes this module a hard
 * build/runtime error if anything under a `'use client'` boundary ever
 * imports it, transitively or not — Next.js's own mechanism for the exact
 * guarantee W18 S3's security regression test needs: the web client's
 * Secrets-Manager-fetched secret can never end up in a browser bundle.
 * `web/src/auth/security.test.ts` asserts this file keeps the directive.
 */

const webClientCredentialsSchema = z.object({
  clientId: z.string().min(1, 'clientId must be a non-empty string'),
  clientSecret: z.string().min(1, 'clientSecret must be a non-empty string'),
});

export type WebClientCredentials = z.infer<typeof webClientCredentialsSchema>;

const requireEnv = (name: string, env: Record<string, string | undefined>): string => {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

/**
 * Fetches the raw `SecretString` for `WEB_CLIENT_CREDENTIALS_SECRET_ARN`
 * (`frontend-stack.ts`'s env var, pointing at `auth-stack.ts`'s
 * `parimaan/web-client-credentials` secret, W18 S1 D1). Mirrors
 * `api/src/ai/geminiClient.ts`'s `fetchGeminiApiKeyFromSecretsManager` shape
 * exactly — same client, same "throw if `SecretString` is missing" check.
 */
const fetchWebClientCredentialsSecretString = async (
  env: Record<string, string | undefined>,
): Promise<string> => {
  const secretArn = requireEnv('WEB_CLIENT_CREDENTIALS_SECRET_ARN', env);
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (result.SecretString === undefined) {
    throw new Error(`Secret ${secretArn} has no SecretString value.`);
  }
  return result.SecretString;
};

export interface WebClientCredentialsDeps {
  /** Defaults to `process.env`. Overridable for tests. */
  env?: Record<string, string | undefined>;
  /** Defaults to fetching from Secrets Manager. Overridable for tests — never hits AWS. */
  fetchSecretString?: (env: Record<string, string | undefined>) => Promise<string>;
}

/**
 * Module-scope memoized credentials promise — same "fetch once per warm
 * instance" discipline as `geminiClient.ts`'s `apiKeyPromise`. A NextAuth
 * cold start pays for exactly one Secrets Manager call; every later
 * `jwt`/`session` callback on the same warm Lambda/Amplify-compute instance
 * reuses it.
 */
let credentialsPromise: Promise<WebClientCredentials> | undefined;

/**
 * Fetches and parses the web client's id/secret. Never called from a
 * `'use client'` file — see the `server-only` import above and
 * `web/src/auth/security.test.ts`'s static regression test.
 */
export const getWebClientCredentials = async (
  deps: WebClientCredentialsDeps = {},
): Promise<WebClientCredentials> => {
  credentialsPromise ??= (async () => {
    const env = deps.env ?? process.env;
    const raw = await (deps.fetchSecretString ?? fetchWebClientCredentialsSecretString)(env);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error('WEB_CLIENT_CREDENTIALS_SECRET_ARN secret does not contain valid JSON.', { cause });
    }

    return webClientCredentialsSchema.parse(parsed);
  })();
  return credentialsPromise;
};

/** Test-only: clears the memoized credentials so the next call fetches fresh. */
export const resetWebClientCredentialsForTesting = (): void => {
  credentialsPromise = undefined;
};
