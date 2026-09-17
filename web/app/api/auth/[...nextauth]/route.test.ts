import { describe, expect, it, vi } from 'vitest';

// Regression test for a real bug: every `/api/auth/*` request 500'd in
// production with "Cannot destructure property 'nextauth' of req.query as
// it is undefined" — found live only once a real build/deploy/IAM/env-var
// chain (findings #7-#9) finally let a real request reach this handler.
// `next-auth`'s `NextAuth(options)` returns `(req, res) => ...` and decides
// Pages-Router vs. App-Router handling by checking `res?.params`
// (`node_modules/next-auth/next/index.js`) — calling it with only `req`
// silently falls into the Pages-Router path, which crashes on `req.query`
// (a Web-standard `NextRequest` has none). This test asserts the route
// handler forwards BOTH arguments to whatever `NextAuth(options)` returns.

const innerHandler = vi.fn(async () => new Response(null, { status: 200 }));
const nextAuthFactory = vi.fn(() => innerHandler);
vi.mock('next-auth', () => ({ default: nextAuthFactory }));

const buildAuthOptions = vi.fn(async () => ({ providers: [] }));
vi.mock('@/auth/config', () => ({ buildAuthOptions }));

const { GET } = await import('./route');

describe('NextAuth App Router route handler', () => {
  it('forwards the route context (params) to the NextAuth handler, not just the request', async () => {
    const req = new Request('https://dev.parimaan.app/api/auth/session') as unknown as Parameters<typeof GET>[0];
    const context = { params: Promise.resolve({ nextauth: ['session'] }) };

    await GET(req, context);

    expect(nextAuthFactory).toHaveBeenCalledWith({ providers: [] });
    expect(innerHandler).toHaveBeenCalledWith(req, context);
  });
});
