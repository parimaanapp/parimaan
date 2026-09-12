import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWebClientCredentials, resetWebClientCredentialsForTesting } from './secrets';

const env = { WEB_CLIENT_CREDENTIALS_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/web-client-credentials-abc' };

afterEach(() => {
  resetWebClientCredentialsForTesting();
  vi.restoreAllMocks();
});

describe('getWebClientCredentials', () => {
  it('parses a valid clientId/clientSecret secret', async () => {
    const fetchSecretString = vi.fn().mockResolvedValue(JSON.stringify({ clientId: 'abc123', clientSecret: 'shh' }));

    const credentials = await getWebClientCredentials({ env, fetchSecretString });

    expect(credentials).toEqual({ clientId: 'abc123', clientSecret: 'shh' });
  });

  it('fetches the secret once and caches it across multiple calls (memoized per warm instance)', async () => {
    const fetchSecretString = vi.fn().mockResolvedValue(JSON.stringify({ clientId: 'abc123', clientSecret: 'shh' }));

    await getWebClientCredentials({ env, fetchSecretString });
    await getWebClientCredentials({ env, fetchSecretString });

    expect(fetchSecretString).toHaveBeenCalledTimes(1);
  });

  it('throws when the secret is not valid JSON', async () => {
    const fetchSecretString = vi.fn().mockResolvedValue('not json');

    await expect(getWebClientCredentials({ env, fetchSecretString })).rejects.toThrow(/valid JSON/);
  });

  it('throws when the secret is missing clientSecret', async () => {
    const fetchSecretString = vi.fn().mockResolvedValue(JSON.stringify({ clientId: 'abc123' }));

    await expect(getWebClientCredentials({ env, fetchSecretString })).rejects.toThrow();
  });

  it('throws a clear error when WEB_CLIENT_CREDENTIALS_SECRET_ARN is unset — checked before any Secrets Manager call', async () => {
    // No `fetchSecretString` override: exercises the real default fetch
    // function's own `requireEnv` guard, which runs before it ever
    // constructs a `SecretsManagerClient`.
    await expect(getWebClientCredentials({ env: {} })).rejects.toThrow(/WEB_CLIENT_CREDENTIALS_SECRET_ARN/);
  });
});
