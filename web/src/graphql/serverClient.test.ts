import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_QUERY } from './queries';

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = 'https://example.appsync-api.ap-south-1.amazonaws.com/graphql';
});

afterEach(() => {
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// RED test 2: a urql request built from a session's idToken carries the
// correct `Authorization` header — exercised against a real urql `Client`
// with a mocked `fetch`, not just the pure header-building helper.
describe('createServerUrqlClient', () => {
  it('attaches Authorization: <idToken> (no Bearer prefix) to every request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { me: { id: 'u1', email: 'a@b.com', displayName: null, avatarUrl: null } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const { createServerUrqlClient } = await import('./serverClient');
    const client = createServerUrqlClient('real-id-token');
    await client.query(ME_QUERY, {}).toPromise();

    expect(fetchImpl).toHaveBeenCalled();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // urql's fetchExchange normalizes header keys to lowercase before the
    // real `fetch` call — asserted case-insensitively for that reason.
    const headers = init.headers as Record<string, string> | Headers;
    const authHeader = headers instanceof Headers ? headers.get('authorization') : headers.authorization;
    expect(authHeader).toBe('real-id-token');
  });
});
