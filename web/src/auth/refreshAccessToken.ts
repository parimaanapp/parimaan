import 'server-only';
import type { JWT } from 'next-auth/jwt';

interface OidcDiscoveryDocument {
  token_endpoint: string;
}

const isDiscoveryDocument = (value: unknown): value is OidcDiscoveryDocument =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { token_endpoint?: unknown }).token_endpoint === 'string';

/**
 * Module-scope memoized discovery document — Cognito's OIDC discovery
 * endpoint (`{issuer}/.well-known/openid-configuration`) is static per user
 * pool, so one fetch per warm instance is enough (same memoization
 * discipline as `secrets.ts`'s `credentialsPromise`). Exists specifically so
 * this module never needs `COGNITO_DOMAIN`/the hosted-UI domain as a second,
 * hardcoded config value — the token endpoint is read from Cognito's own
 * discovery document instead of re-deriving the domain-naming rule a third
 * place (`auth-stack.ts` and `frontend-stack.ts` already both compute it
 * once each).
 */
let discoveryPromise: Promise<OidcDiscoveryDocument> | undefined;

const getDiscoveryDocument = async (
  issuer: string,
  fetchImpl: typeof fetch,
): Promise<OidcDiscoveryDocument> => {
  discoveryPromise ??= (async () => {
    const response = await fetchImpl(`${issuer}/.well-known/openid-configuration`);
    if (!response.ok) {
      throw new Error(`OIDC discovery failed (HTTP ${response.status}).`);
    }
    const body: unknown = await response.json();
    if (!isDiscoveryDocument(body)) {
      throw new Error('OIDC discovery document has no token_endpoint.');
    }
    return body;
  })();
  return discoveryPromise;
};

/** Test-only: clears the memoized discovery document. */
export const resetDiscoveryDocumentForTesting = (): void => {
  discoveryPromise = undefined;
};

interface RefreshedTokenResponse {
  id_token?: unknown;
  expires_in?: unknown;
}

const isRefreshedTokenResponse = (value: unknown): value is RefreshedTokenResponse =>
  typeof value === 'object' && value !== null;

/**
 * W18 D2: "reuse NextAuth's own built-in OAuth refresh-token rotation — no
 * custom refresh logic." NextAuth v4 does not auto-refresh a generic
 * provider's token on its own; its documented extension point for this is
 * exactly what this function is called from — the `jwt` callback, which
 * re-runs on every session check. This function performs one real OAuth
 * `refresh_token` grant against Cognito's own discovered token endpoint, via
 * an injectable `fetchImpl` so tests never hit real Cognito (mirrors
 * `geminiClient.ts`'s `fetchImpl` override for the identical reason).
 *
 * Never throws outward — a failed refresh is surfaced as `token.error`
 * (`'RefreshAccessTokenError'`), matching NextAuth's own documented
 * "refresh token rotation" recipe, so a caller (the `session` callback, and
 * ultimately a page reading `session.error`) can react instead of a raw
 * exception breaking every subsequent `getServerSession`/`useSession` call.
 */
export const refreshAccessToken = async (
  token: JWT,
  credentials: { clientId: string; clientSecret: string },
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JWT> => {
  if (!token.refreshToken) {
    return { ...token, error: 'RefreshAccessTokenError' };
  }

  try {
    const { token_endpoint } = await getDiscoveryDocument(issuer, fetchImpl);
    const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

    const response = await fetchImpl(token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credentials.clientId,
        refresh_token: token.refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Cognito token refresh failed (HTTP ${response.status}).`);
    }

    const body: unknown = await response.json();
    if (!isRefreshedTokenResponse(body) || typeof body.id_token !== 'string') {
      throw new Error('Cognito token refresh response has no id_token.');
    }

    const expiresInSeconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    return {
      ...token,
      idToken: body.id_token,
      accessTokenExpiresAt: Date.now() + expiresInSeconds * 1000,
      error: undefined,
    };
  } catch {
    // Never rethrown — see doc comment above. The specific cause is not
    // logged here to avoid ever letting a token/credential end up in logs;
    // `invokeModel.ts`'s own "no vendor wording to the user" caution applies
    // equally to not echoing raw OAuth error bodies.
    return { ...token, error: 'RefreshAccessTokenError' };
  }
};
