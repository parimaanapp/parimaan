import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import CognitoProvider from 'next-auth/providers/cognito';
import { jwtCallback, sessionCallback } from './callbacks';
import { loadWebAuthConfig } from './env';
import { getNextAuthSecret } from './nextAuthSecret';
import { getWebClientCredentials } from './secrets';

/**
 * Builds NextAuth's options asynchronously, not as a static module-scope
 * object — the Cognito provider's `clientSecret` is only available after
 * the Secrets Manager fetch in `secrets.ts` resolves (W18 S1 D1: the secret
 * is deliberately never a plain env var). `web/app/api/auth/[...nextauth]/
 * route.ts` awaits this once per request; `getWebClientCredentials`'s own
 * memoization means only the first request per warm instance actually pays
 * for the Secrets Manager round trip.
 */
export const buildAuthOptions = async (): Promise<NextAuthOptions> => {
  const { issuer } = loadWebAuthConfig();
  const credentials = await getWebClientCredentials();
  // Closes a gap this slice's own earlier report flagged rather than
  // invented fresh: without a stable `secret`, NextAuth falls back to an
  // ephemeral auto-generated value (fine for a single local `next dev`
  // process, broken across Amplify Hosting's multiple SSR compute
  // instances — each would sign/encrypt JWTs differently and sessions
  // would fail unpredictably depending on which instance served a given
  // request). `frontend-stack.ts`'s own same-week follow-up fix provisions
  // a real Secrets-Manager-held random secret for exactly this.
  const secret = await getNextAuthSecret();

  return {
    providers: [
      CognitoProvider({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        issuer,
      }),
    ],
    secret,
    // No `NEXTAUTH_URL` env var is set (`frontend-stack.ts` doesn't wire
    // one — a gap named explicitly in this slice's report): the App
    // Router's own `NextAuth(options)(req)` curried handler is called with
    // the real `NextRequest`, and next-auth's own App Router support reads
    // the host from that request rather than requiring the env var, the
    // same way every other App Router NextAuth app avoids hardcoding it.
    session: { strategy: 'jwt' },
    callbacks: {
      jwt: ({ token, account }) =>
        jwtCallback(token, account, {
          getCredentials: getWebClientCredentials,
          issuer,
        }),
      session: ({ session, token }) => sessionCallback(session, token),
    },
  };
};
