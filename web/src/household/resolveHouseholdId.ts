import type { Client } from 'urql';
import { MY_HOUSEHOLDS_QUERY, type MyHouseholdsQueryResult } from '@/graphql/queries';

/**
 * D3 (`docs/E2E_MVP_PLAN.md` §24.2.3): every screen resolves
 * `me.households[0]` — the caller's first/primary membership, in whatever
 * order `Query.me`'s own resolver already returns — as the active
 * household for the whole session, with no switcher UI.
 *
 * The one consolidated household-resolution helper: previously three
 * near-identical copies (`dashboard/resolvePrimaryHousehold.ts`,
 * `household/resolveHousehold.ts`, `graphql/resolveHouseholdId.ts`) with
 * three genuinely different contracts — one silently swallowed real
 * GraphQL errors as "no household" (masking a real failure behind a
 * misleading empty state), one threw on "no household" instead of
 * rendering the same graceful empty state every other screen already had.
 * This is the one contract every caller now gets: a real query error is a
 * real error (never silently reinterpreted as "no household," per this
 * codebase's own "never silently swallow errors" convention) and is
 * always a `Client`-based call — the only shape that lets a caller build
 * one client per request and reuse it for whatever query comes after,
 * rather than constructing a second client just for this call.
 */
export const resolveHouseholdId = async (client: Client): Promise<string | null> => {
  const result = await client.query<MyHouseholdsQueryResult>(MY_HOUSEHOLDS_QUERY, {}).toPromise();
  if (result.error) {
    throw result.error;
  }
  return result.data?.me.households[0]?.household.id ?? null;
};
