import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'urql';
import { resolveHouseholdId } from './resolveHouseholdId';

type Membership = { joinedAt?: string; household: { id: string } };

const fakeClient = (households: Membership[]): Client =>
  ({
    query: vi.fn().mockReturnValue({
      toPromise: () => Promise.resolve({ data: { me: { households } }, error: undefined }),
    }),
  }) as unknown as Client;

describe('resolveHouseholdId', () => {
  // D3: the web dashboard defaults to the caller's first household.
  it("resolves me.households[0].household.id — never a second household this caller happens to also belong to", async () => {
    const client = fakeClient([
      { joinedAt: '2026-01-01T00:00:00Z', household: { id: 'hh-1' } },
      { joinedAt: '2026-02-01T00:00:00Z', household: { id: 'hh-2' } },
    ]);

    await expect(resolveHouseholdId(client)).resolves.toBe('hh-1');
  });

  // A9: determinism must not depend on the server's row order.
  it('picks the earliest joinedAt regardless of the order the server returned', async () => {
    const client = fakeClient([
      { joinedAt: '2026-03-01T00:00:00Z', household: { id: 'hh-late' } },
      { joinedAt: '2026-01-01T00:00:00Z', household: { id: 'hh-early' } },
    ]);

    await expect(resolveHouseholdId(client)).resolves.toBe('hh-early');
  });

  it('breaks a joinedAt tie by household id, so the same input always resolves the same household', async () => {
    const same = '2026-01-01T00:00:00Z';
    const a = fakeClient([
      { joinedAt: same, household: { id: 'hh-b' } },
      { joinedAt: same, household: { id: 'hh-a' } },
    ]);
    const b = fakeClient([
      { joinedAt: same, household: { id: 'hh-a' } },
      { joinedAt: same, household: { id: 'hh-b' } },
    ]);

    await expect(resolveHouseholdId(a)).resolves.toBe('hh-a');
    await expect(resolveHouseholdId(b)).resolves.toBe('hh-a');
  });

  // Named gap, not a crash: a caller with no household yet gets `null`,
  // never an uncaught error or a thrown exception — every screen renders
  // its own graceful empty state for this.
  it('returns null when the caller belongs to no household', async () => {
    const client = fakeClient([]);

    await expect(resolveHouseholdId(client)).resolves.toBeNull();
  });

  // The contract this consolidation fixed: a real GraphQL error must never
  // be silently reinterpreted as "no household" (one of the three original
  // copies did exactly that) — it propagates as a real thrown error.
  it('propagates a GraphQL error rather than silently resolving to null', async () => {
    const client = {
      query: vi.fn().mockReturnValue({
        toPromise: () => Promise.resolve({ data: undefined, error: new Error('boom') }),
      }),
    } as unknown as Client;

    await expect(resolveHouseholdId(client)).rejects.toThrow('boom');
  });
});
