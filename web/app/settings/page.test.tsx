// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { cacheExchange, Client, fetchExchange, Provider } from 'urql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL;

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/auth/config', () => ({ buildAuthOptions: vi.fn().mockResolvedValue({}) }));

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const settingsFixture = {
  mealsEnabled: ['breakfast', 'dinner'],
  mealStructure: '{"dinner":{"carb":2,"sabzi_dal":1,"accompaniment":1}}',
  cuisineTier1: ['north_indian'],
  cuisineTier2Weights: '{}',
  dietaryTags: ['veg'],
  allergens: ['peanuts'],
  skipIngredients: [],
};

/**
 * Routes a stubbed `fetch` to the right canned response by the request's
 * GraphQL query text — read from the request body for a POST (mutations)
 * or from the `query` URL param for a GET (urql's default transport for
 * queries, confirmed by inspecting a real request during this slice's own
 * implementation), like a miniature mock AppSync.
 */
const queryTextOf = (url: string, init: RequestInit): string => {
  if (init.body) {
    return (JSON.parse(init.body as string) as { query: string }).query;
  }
  return new URL(url).searchParams.get('query') ?? '';
};

const stubFetchRouter = (householdId: string) => {
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    const queryText = queryTextOf(url, init);
    if (queryText.includes('MyHouseholds')) {
      return new Response(JSON.stringify({ data: { me: { households: [{ household: { id: householdId } }] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: { household: { id: householdId, settings: settingsFixture } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = 'https://example.appsync-api.ap-south-1.amazonaws.com/graphql';
  getServerSession.mockReset();
  redirect.mockClear();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = ORIGINAL_ENV;
  vi.restoreAllMocks();
  cleanup();
});

describe('SettingsPage', () => {
  // RED test 5: an unauthenticated visit redirects to sign-in.
  it('redirects to sign-in when there is no session', async () => {
    getServerSession.mockResolvedValue(null);
    const { default: SettingsPage } = await import('./page');

    await expect(SettingsPage()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith('/api/auth/signin?callbackUrl=%2Fsettings');
  });

  // RED test 3: the form is pre-populated with the real current settings on load.
  it('pre-populates the form with the real current settings', async () => {
    getServerSession.mockResolvedValue({ idToken: 'real-token', expires: '2099-01-01' });
    stubFetchRouter('hh-42');
    const { default: SettingsPage } = await import('./page');

    // Section components are client components that call `useMutation`
    // (for their own "Save"), so rendering the page's output here — same as
    // `app/layout.tsx` does in the real app — needs a urql `Provider` in
    // scope, even though this test never exercises a mutation itself.
    const client = new Client({
      url: 'https://example.appsync-api.ap-south-1.amazonaws.com/graphql',
      exchanges: [cacheExchange, fetchExchange],
    });
    render(<Provider value={client}>{await SettingsPage()}</Provider>);

    expect(screen.getByLabelText('Enable Breakfast')).toBeChecked();
    expect(screen.getByLabelText('Enable Lunch')).not.toBeChecked();
    expect(screen.getByLabelText('North Indian')).toBeChecked();
    expect(screen.getByLabelText('Vegetarian')).toBeChecked();
    expect(screen.getByText('peanuts')).toBeInTheDocument();
  });

  // RED test 6: the page resolves the caller's own household and uses that
  // same id for the settings query — never a hardcoded or different id.
  it("reads this caller's own resolved household, not a different one", async () => {
    getServerSession.mockResolvedValue({ idToken: 'real-token', expires: '2099-01-01' });
    const fetchImpl = stubFetchRouter('hh-42');
    const { default: SettingsPage } = await import('./page');

    await SettingsPage();

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const settingsCall = calls.find(([url, init]) => queryTextOf(url, init).includes('HouseholdSettingsQuery'));
    expect(settingsCall).toBeDefined();
    const [url] = settingsCall as [string, RequestInit];
    const variables = JSON.parse(new URL(url).searchParams.get('variables') ?? '{}') as { householdId: string };
    expect(variables.householdId).toBe('hh-42');
  });
});
