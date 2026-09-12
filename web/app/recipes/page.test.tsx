import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/auth/config', () => ({ buildAuthOptions: vi.fn().mockResolvedValue({}) }));

const query = vi.fn();
vi.mock('@/graphql/serverClient', () => ({
  createServerUrqlClient: () => ({ query }),
}));

const { default: RecipesPage } = await import('./page');

beforeEach(() => {
  redirect.mockClear();
  getServerSession.mockReset();
  query.mockReset();
});

describe('RecipesPage', () => {
  // RED test 5: an unauthenticated visit to the recipes screen redirects
  // to sign-in, and never reaches the (real, network-hitting) GraphQL
  // query in the process.
  it('redirects to sign-in before querying anything, when there is no session', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(RecipesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/api/auth/signin?callbackUrl=%2Frecipes',
    );

    expect(query).not.toHaveBeenCalled();
  });
});
