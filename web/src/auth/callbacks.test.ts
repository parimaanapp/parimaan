import type { Account } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jwtCallback, sessionCallback } from './callbacks';
import { resetDiscoveryDocumentForTesting } from './refreshAccessToken';

const credentials = { clientId: 'web-client-id', clientSecret: 'web-client-secret' };
const issuer = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_example';

const fakeAccount = (overrides: Partial<Account> = {}): Account => ({
  provider: 'cognito',
  type: 'oauth',
  providerAccountId: 'user-1',
  id_token: 'real-id-token',
  refresh_token: 'real-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  ...overrides,
});

afterEach(() => {
  resetDiscoveryDocumentForTesting();
  vi.restoreAllMocks();
});

describe('jwtCallback', () => {
  // RED test 1: a signed-in session's token includes a real, correctly
  // shaped ID token — mocking the provider's account payload (first
  // sign-in), never hitting real Cognito.
  it('persists idToken/refreshToken/accessTokenExpiresAt onto the token on first sign-in', async () => {
    const token = await jwtCallback({} as JWT, fakeAccount(), { getCredentials: async () => credentials, issuer });

    expect(token.idToken).toBe('real-id-token');
    expect(token.refreshToken).toBe('real-refresh-token');
    expect(typeof token.accessTokenExpiresAt).toBe('number');
    expect(token.accessTokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it('returns the token unchanged on a later session check while still valid (no account, not expired)', async () => {
    const validToken: JWT = { idToken: 'still-valid', refreshToken: 'rt', accessTokenExpiresAt: Date.now() + 60_000 };
    const getCredentials = vi.fn();

    const result = await jwtCallback(validToken, null, { getCredentials, issuer });

    expect(result).toEqual(validToken);
    expect(getCredentials).not.toHaveBeenCalled();
  });

  // RED test 3: an expired token triggers NextAuth's own refresh path (the
  // `jwt` callback re-running on a session check) — mocking the provider's
  // token endpoint, never hitting real Cognito.
  it('refreshes an expired token via the provider token endpoint', async () => {
    const expiredToken: JWT = { idToken: 'stale', refreshToken: 'rt-1', accessTokenExpiresAt: Date.now() - 1000 };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token_endpoint: 'https://parimaan-dev.auth.ap-south-1.amazoncognito.com/oauth2/token' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: 'fresh-id-token', expires_in: 3600 }), { status: 200 }));

    const result = await jwtCallback(expiredToken, null, {
      getCredentials: async () => credentials,
      issuer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.idToken).toBe('fresh-id-token');
    expect(result.error).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(tokenUrl).toBe('https://parimaan-dev.auth.ap-south-1.amazoncognito.com/oauth2/token');
    expect((tokenInit.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it('marks the token with RefreshAccessTokenError when the refresh call fails', async () => {
    const expiredToken: JWT = { idToken: 'stale', refreshToken: 'rt-1', accessTokenExpiresAt: Date.now() - 1000 };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));

    const result = await jwtCallback(expiredToken, null, {
      getCredentials: async () => credentials,
      issuer,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.error).toBe('RefreshAccessTokenError');
  });
});

describe('sessionCallback', () => {
  it('surfaces idToken onto the session object', () => {
    const session = sessionCallback({ expires: '2099-01-01' }, { idToken: 'session-id-token' } as JWT);

    expect(session.idToken).toBe('session-id-token');
  });

  it('surfaces a refresh error onto the session object', () => {
    const session = sessionCallback({ expires: '2099-01-01' }, { error: 'RefreshAccessTokenError' } as JWT);

    expect(session.error).toBe('RefreshAccessTokenError');
  });
});
