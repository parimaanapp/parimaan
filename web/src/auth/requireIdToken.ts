import 'server-only';
import { redirect } from 'next/navigation';
import type { Session } from 'next-auth';

/**
 * Guards a server component page: redirects to sign-in (rather than
 * rendering with no data) when there is no session or no `idToken` on it —
 * the plan's own explicit RED test for "an unauthenticated page/Route
 * Handler redirects to sign-in rather than rendering with no data."
 * `redirect()` throws internally (Next's `NEXT_REDIRECT` control-flow
 * signal) so the `throw` below is unreachable in practice; it exists only
 * so this function's return type stays `string`, not `string | undefined`.
 */
export const requireIdToken = (session: Session | null, callbackPath: string): string => {
  if (!session?.idToken) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackPath)}`);
    throw new Error('unreachable: redirect() always throws');
  }
  return session.idToken;
};
