import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { cacheExchange, Client, fetchExchange, Provider } from 'urql';
import { vi } from 'vitest';

export interface GraphQLRequestBody {
  query: string;
  variables: Record<string, unknown>;
}

/**
 * Test-only helper shared by every settings section's own test file: stubs
 * global `fetch` with the given responder and renders `ui` inside a real
 * urql `Provider` — a real `Client`, not a mock of urql's own internals, so
 * these tests exercise the actual `useMutation` wiring and assert on the
 * actual HTTP request body `useMutation` produced, per this slice's own
 * "assert on the actual constructed mutation variables object" requirement.
 */
export const renderWithUrql = (
  ui: ReactElement,
  respond: (body: GraphQLRequestBody) => unknown,
): { fetchImpl: ReturnType<typeof vi.fn>; requests: GraphQLRequestBody[] } => {
  const requests: GraphQLRequestBody[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as GraphQLRequestBody;
    requests.push(body);
    return new Response(JSON.stringify(respond(body)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchImpl);

  const client = new Client({
    url: 'https://example.appsync-api.ap-south-1.amazonaws.com/graphql',
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => ({ headers: { Authorization: 'real-id-token' } }),
  });

  render(<Provider value={client}>{ui}</Provider>);
  return { fetchImpl, requests };
};
