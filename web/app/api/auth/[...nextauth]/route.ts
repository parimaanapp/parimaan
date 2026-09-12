import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { buildAuthOptions } from '@/auth/config';

/**
 * App Router's catch-all convention for NextAuth v4
 * (`app/api/auth/[...nextauth]/route.ts`, matching `callbackUrls: ['https://
 * {webDomain}/api/auth/callback/cognito']` already baked into
 * `auth-stack.ts`'s `webClient`). `buildAuthOptions()` is awaited per
 * request rather than built once at module scope — see that function's own
 * doc comment for why (the Cognito client secret is only available after an
 * async Secrets Manager fetch).
 */
const handle = async (req: NextRequest): Promise<Response> => {
  const options = await buildAuthOptions();
  return NextAuth(options)(req);
};

export { handle as GET, handle as POST };
