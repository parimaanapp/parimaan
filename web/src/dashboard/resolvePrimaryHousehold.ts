import 'server-only';
import type { Client } from 'urql';
import { MY_HOUSEHOLDS_QUERY, type MyHouseholdsQueryResult } from '@/graphql/queries';

/**
 * D3 (§24.2.3): the web dashboard resolves `me.households[0]` — the
 * caller's first/primary membership, in whatever order `Query.me`'s own
 * resolver already returns — as the active household for the whole
 * session, with no switcher UI. Returns `null` when the caller belongs to
 * no household at all (not itself one of the plan's three named empty
 * states, but a real edge case this function must not throw on — an
 * account that somehow has zero memberships gets an honest "no household"
 * message from the page, not a crash).
 */
export const resolvePrimaryHouseholdId = async (client: Client): Promise<string | null> => {
  const result = await client.query<MyHouseholdsQueryResult>(MY_HOUSEHOLDS_QUERY, {}).toPromise();
  if (result.error) {
    throw result.error;
  }
  const households = result.data?.me.households ?? [];
  return households[0]?.household.id ?? null;
};
