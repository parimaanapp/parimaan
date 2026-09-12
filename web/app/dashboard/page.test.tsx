// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL;

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession }));

const buildAuthOptions = vi.fn().mockResolvedValue({});
vi.mock('@/auth/config', () => ({ buildAuthOptions }));

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const HOUSEHOLD_A = 'household-aaa';
const HOUSEHOLD_B = 'household-bbb';

interface GraphqlCall {
  operationName: string;
  variables: Record<string, unknown>;
}

/**
 * A fetch mock keyed by GraphQL operation name — each of
 * `loadDashboardData`'s/`resolvePrimaryHouseholdId`'s own queries
 * (`MyHouseholds`/`Pantry`/`Menu`/`ShoppingList`) is a distinct named
 * operation, so routing by name (rather than by call order) mirrors how a
 * real GraphQL server dispatches and lets each test assert on the exact
 * variables a specific query was built with.
 */
function mockGraphqlFetch(responses: Record<string, unknown>): { calls: GraphqlCall[] } {
  const calls: GraphqlCall[] = [];
  // urql's `fetchExchange` sends a GET request for every query, with
  // `operationName`/`variables` as URL search params (not a POST body) —
  // confirmed against this app's real `createServerUrqlClient` rather than
  // assumed, since `serverClient.test.ts`'s own RED test only asserts on
  // `init.headers`, never `init.body`.
  const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
    const params = new URL(url).searchParams;
    const operationName = params.get('operationName') ?? 'unknown';
    const variables = JSON.parse(params.get('variables') ?? '{}') as Record<string, unknown>;
    calls.push({ operationName, variables });
    const data = responses[operationName];
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchImpl);
  return { calls };
}

const fullFixtures = {
  MyHouseholds: { me: { households: [{ household: { id: HOUSEHOLD_A } }, { household: { id: HOUSEHOLD_B } }] } },
  Pantry: {
    pantry: [
      { id: 'p1', name: 'Toor dal', quantity: 2, unit: 'kg', category: 'dal', isStaple: true, expiryDate: null },
      { id: 'p2', name: 'Milk', quantity: 1, unit: 'L', category: 'dairy', isStaple: false, expiryDate: null },
    ],
  },
  Menu: {
    menu: {
      id: 'menu-1',
      weekStartDate: '2026-09-07T00:00:00.000Z',
      items: [
        {
          id: 'mi1',
          dayOfWeek: 0,
          mealSlot: 'lunch',
          slotRole: 'carb',
          recipe: { id: 'r1', title: 'Jeera Rice' },
        },
      ],
    },
  },
  ShoppingList: {
    shoppingList: {
      id: 'sl1',
      items: [
        { id: 'sli1', name: 'Onions', quantity: 2, unit: 'kg', category: 'produce', purchased: false },
      ],
    },
  },
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = 'https://example.appsync-api.ap-south-1.amazonaws.com/graphql';
  getServerSession.mockReset();
  buildAuthOptions.mockClear();
  redirect.mockClear();
});

afterEach(() => {
  cleanup();
  process.env.NEXT_PUBLIC_APPSYNC_GRAPHQL_URL = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe('DashboardPage', () => {
  // RED test 1: renders real pantry/menu/list data for the resolved household.
  it('renders real pantry, menu, and shopping-list data', async () => {
    getServerSession.mockResolvedValue({ idToken: 'real-token', expires: '2099-01-01' });
    mockGraphqlFetch(fullFixtures);

    const { default: DashboardPage } = await import('./page');
    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByText('Toor dal — 2 kg')).toBeInTheDocument();
    expect(screen.getByText('Milk — 1 L')).toBeInTheDocument();
    expect(screen.getByText('Jeera Rice')).toBeInTheDocument();
    expect(screen.getByText(/Onions/)).toBeInTheDocument();
    expect(screen.queryByTestId('pantry-empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shopping-list-empty-state')).not.toBeInTheDocument();
  });

  // RED test 2: the pantry section's own empty state, independent of the
  // other two sections having real data.
  it('renders the pantry section empty state when pantry is empty, independent of menu/list state', async () => {
    getServerSession.mockResolvedValue({ idToken: 'real-token', expires: '2099-01-01' });
    mockGraphqlFetch({ ...fullFixtures, Pantry: { pantry: [] } });

    const { default: DashboardPage } = await import('./page');
    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByTestId('pantry-empty-state')).toHaveTextContent('No pantry items yet.');
    expect(screen.getByText('Jeera Rice')).toBeInTheDocument();
    expect(screen.getByText(/Onions/)).toBeInTheDocument();
  });

  // RED test 3: the menu section's own empty state when menu is null.
  it('renders the menu section empty state when no menu exists for this week, independent of pantry/list state', async () => {
    getServerSession.mockResolvedValue({ idToken: 'real-token', expires: '2099-01-01' });
    mockGraphqlFetch({ ...fullFixtures, Menu: { menu: null } });

    const { default: DashboardPage } = await import('./page');
    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByTestId('menu-empty-state')).toHaveTextContent("No plan for this week yet.");
    expect(screen.getByText('Toor dal — 2 kg')).toBeInTheDocument();
    // No menu this week means no menuId to key a shopping list off of —
    // the shopping-list section must independently show its own empty
    // state too, without ever issuing the ShoppingList query.
    expect(screen.getByTestId('shopping-list-empty-state')).toBeInTheDocument();
  });

  // RED test 4: the shopping-list section's own empty state when
  // shoppingList is null, independent of pantry/menu state.
  it('renders the shopping-list section empty state when no list has been generated yet', async () => {
    getServerSession.mockResolvedValue({ idToken: 'real-token', expires: '2099-01-01' });
    mockGraphqlFetch({ ...fullFixtures, ShoppingList: { shoppingList: null } });

    const { default: DashboardPage } = await import('./page');
    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByTestId('shopping-list-empty-state')).toHaveTextContent('No shopping list yet.');
    expect(screen.getByText('Toor dal — 2 kg')).toBeInTheDocument();
    expect(screen.getByText('Jeera Rice')).toBeInTheDocument();
  });

  // RED test 5: an unauthenticated visit redirects to sign-in, reusing
  // `requireIdToken`'s own S3 gating.
  it('redirects to sign-in when there is no session', async () => {
    getServerSession.mockResolvedValue(null);
    mockGraphqlFetch(fullFixtures);

    const { default: DashboardPage } = await import('./page');

    await expect(DashboardPage()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith('/api/auth/signin?callbackUrl=%2Fdashboard');
  });

  // RED test 6: never renders a second household's data — the query is
  // built with the resolved household's own id (`households[0]`), not a
  // client-suppliable one.
  it('queries using only the resolved primary household id, never a second membership', async () => {
    getServerSession.mockResolvedValue({ idToken: 'real-token', expires: '2099-01-01' });
    const { calls } = mockGraphqlFetch(fullFixtures);

    const { default: DashboardPage } = await import('./page');
    const ui = await DashboardPage();
    render(ui);

    const pantryCall = calls.find((call) => call.operationName === 'Pantry');
    const menuCall = calls.find((call) => call.operationName === 'Menu');

    expect(pantryCall?.variables.householdId).toBe(HOUSEHOLD_A);
    expect(menuCall?.variables.householdId).toBe(HOUSEHOLD_A);
    expect(pantryCall?.variables.householdId).not.toBe(HOUSEHOLD_B);
    expect(menuCall?.variables.householdId).not.toBe(HOUSEHOLD_B);
  });
});
