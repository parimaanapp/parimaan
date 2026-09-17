import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { buildAuthOptions } from '@/auth/config';

interface RouteContext {
  params: Promise<{ nextauth: string[] }>;
}

/**
 * App Router's catch-all convention for NextAuth v4
 * (`app/api/auth/[...nextauth]/route.ts`, matching `callbackUrls: ['https://
 * {webDomain}/api/auth/callback/cognito']` already baked into
 * `auth-stack.ts`'s `webClient`). `buildAuthOptions()` is awaited per
 * request rather than built once at module scope — see that function's own
 * doc comment for why (the Cognito client secret is only available after an
 * async Secrets Manager fetch).
 *
 * The `context` (second) argument is not optional despite looking like it:
 * `next-auth`'s own `NextAuth(options)` returns `(req, res) => ...` and
 * decides Pages-Router vs. App-Router handling by checking `res?.params`
 * (`node_modules/next-auth/next/index.js`) — call it with only `req` and it
 * silently falls into the Pages-Router path, which crashes trying to
 * destructure `req.query` (a Web-standard `NextRequest` has no `.query`).
 * Found live: every `/api/auth/*` request 500'd with exactly that crash
 * once a real build/deploy/IAM/env-var chain (findings #7-#9) finally let a
 * real request reach this handler for the first time.
 */
const handle = async (req: NextRequest, context: RouteContext): Promise<Response> => {
  const options = await buildAuthOptions();
  return NextAuth(options)(req, context);
};

export { handle as GET, handle as POST };
