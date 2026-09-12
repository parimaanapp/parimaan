import 'server-only';
import type { Account, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { refreshAccessToken } from './refreshAccessToken';
import type { WebClientCredentials } from './secrets';

export interface JwtCallbackDeps {
  getCredentials: () => Promise<WebClientCredentials>;
  issuer: string;
  fetchImpl?: typeof fetch;
  /** Overridable for tests — defaults to the real wall clock. */
  now?: () => number;
}

/**
 * W18 D2's `jwt` callback: on first sign-in (`account` present), persists the
 * raw Cognito `id_token`/`refresh_token`/expiry onto NextAuth's own JWT —
 * the one piece of state NextAuth's default behavior otherwise discards.
 * On every later call (no `account` — a session check, not a fresh
 * sign-in), returns the token unchanged while still valid, or refreshes it
 * via `refreshAccessToken` once expired. This is the exact extension point
 * D2 names ("re-runs on every session check ... is where an expired-ID-token
 * refresh already belongs").
 */
export const jwtCallback = async (
  token: JWT,
  account: Account | null | undefined,
  deps: JwtCallbackDeps,
): Promise<JWT> => {
  const now = deps.now ?? Date.now;

  if (account) {
    return {
      ...token,
      idToken: typeof account.id_token === 'string' ? account.id_token : undefined,
      refreshToken: typeof account.refresh_token === 'string' ? account.refresh_token : undefined,
      accessTokenExpiresAt: typeof account.expires_at === 'number' ? account.expires_at * 1000 : undefined,
      error: undefined,
    };
  }

  if (token.accessTokenExpiresAt && now() < token.accessTokenExpiresAt) {
    return token;
  }

  const credentials = await deps.getCredentials();
  return refreshAccessToken(token, credentials, deps.issuer, deps.fetchImpl);
};

/**
 * W18 D2's `session` callback: surfaces the JWT's raw `idToken` (and any
 * refresh `error`) onto the session object both `getServerSession` and
 * `useSession` read — the value urql's `Authorization` header needs.
 * Deliberately does not surface `refreshToken` onto the session — that
 * value has no legitimate reader on the client/session side and exists only
 * inside NextAuth's own encrypted JWT cookie.
 */
export const sessionCallback = (session: Session, token: JWT): Session => ({
  ...session,
  idToken: token.idToken,
  error: token.error,
});
