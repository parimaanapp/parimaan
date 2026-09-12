/**
 * Module augmentation for W18 D2: NextAuth's `jwt`/`session` callbacks
 * persist the raw Cognito ID token (and refresh metadata) onto NextAuth's
 * own JWT and session shapes. Declared once here so every file reading
 * `session.idToken` / `token.idToken` gets real typing instead of a cast.
 */
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    /** Raw Cognito ID token — what urql's `Authorization` header needs, not NextAuth's own re-encrypted session token. */
    idToken?: string | undefined;
    /** Set to `'RefreshAccessTokenError'` when refresh fails; callers should treat the session as unusable for GraphQL calls. */
    error?: string | undefined;
    user?: DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    idToken?: string | undefined;
    refreshToken?: string | undefined;
    /** Epoch milliseconds — when `idToken` stops being valid. */
    accessTokenExpiresAt?: number | undefined;
    error?: string | undefined;
  }
}
