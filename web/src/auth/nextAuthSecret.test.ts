import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNextAuthSecret, resetNextAuthSecretForTesting } from './nextAuthSecret';

const env = { NEXTAUTH_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/nextauth-secret-dev-abc' };

afterEach(() => {
  resetNextAuthSecretForTesting();
  vi.restoreAllMocks();
});

describe('getNextAuthSecret', () => {
  it('returns the fetched secret string as-is, with no parsing', async () => {
    const fetchSecretString = vi.fn().mockResolvedValue('a-real-random-secret-value');

    const secret = await getNextAuthSecret({ env, fetchSecretString });

    expect(secret).toBe('a-real-random-secret-value');
  });

  it('fetches the secret once and caches it across multiple calls (memoized per warm instance)', async () => {
    const fetchSecretString = vi.fn().mockResolvedValue('a-real-random-secret-value');

    await getNextAuthSecret({ env, fetchSecretString });
    await getNextAuthSecret({ env, fetchSecretString });

    expect(fetchSecretString).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when NEXTAUTH_SECRET_ARN is unset — checked before any Secrets Manager call', async () => {
    await expect(getNextAuthSecret({ env: {} })).rejects.toThrow(/NEXTAUTH_SECRET_ARN/);
  });
});
