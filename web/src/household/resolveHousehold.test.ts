import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'urql';
import { resolveHouseholdId } from './resolveHousehold';

const fakeClient = (households: Array<{ household: { id: string; name: string } }>): Client =>
  ({
    query: vi.fn().mockReturnValue({
      toPromise: () =>
        Promise.resolve({
          data: { me: { id: 'u1', households } },
          error: undefined,
        }),
    }),
  }) as unknown as Client;

describe('resolveHouseholdId', () => {
  // D3: the web dashboard defaults to the caller's first household.
  it('returns the id of the caller\'s first household membership', async () => {
    const client = fakeClient([
      { household: { id: 'h1', name: 'First' } },
      { household: { id: 'h2', name: 'Second' } },
    ]);

    await expect(resolveHouseholdId(client)).resolves.toBe('h1');
  });

  // Named gap, not a crash: a caller with no household yet gets `null`,
  // never an uncaught error or a thrown exception.
  it('returns null when the caller belongs to no household yet', async () => {
    const client = fakeClient([]);

    await expect(resolveHouseholdId(client)).resolves.toBeNull();
  });

  it('returns null and never throws on a GraphQL error response', async () => {
    const client = {
      query: vi.fn().mockReturnValue({
        toPromise: () => Promise.resolve({ data: undefined, error: new Error('boom') }),
      }),
    } as unknown as Client;

    await expect(resolveHouseholdId(client)).resolves.toBeNull();
  });
});
