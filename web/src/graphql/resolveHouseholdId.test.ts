import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = 'https://example.appsync-api.ap-south-1.amazonaws.com/graphql';
});

afterEach(() => {
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

const stubFetchWithHouseholds = (households: Array<{ household: { id: string } }>) => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: { me: { households } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
};

describe('resolveHouseholdId', () => {
  // RED test 6 (half): resolves the caller's OWN first household, matching
  // D3's `me.households[0]` rule — never a second household this caller
  // happens to also belong to.
  it('resolves me.households[0].household.id', async () => {
    stubFetchWithHouseholds([{ household: { id: 'hh-1' } }, { household: { id: 'hh-2' } }]);

    const { resolveHouseholdId } = await import('./resolveHouseholdId');
    const householdId = await resolveHouseholdId('real-id-token');

    expect(householdId).toBe('hh-1');
  });

  it('throws when the caller belongs to no household', async () => {
    stubFetchWithHouseholds([]);

    const { resolveHouseholdId } = await import('./resolveHouseholdId');

    await expect(resolveHouseholdId('real-id-token')).rejects.toThrow(/no household/i);
  });

  it('propagates a GraphQL error rather than silently resolving an id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: null, errors: [{ message: 'Unauthorized' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const { resolveHouseholdId } = await import('./resolveHouseholdId');

    await expect(resolveHouseholdId('real-id-token')).rejects.toBeTruthy();
  });
});
