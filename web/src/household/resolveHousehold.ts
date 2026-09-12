import type { Client } from 'urql';
import { MY_HOUSEHOLDS_QUERY, type MyHouseholdsQueryResult } from './householdQueries';

/**
 * W18 D3's household resolution: `me.households[0]` is the resolved active
 * household for the whole session. Returns `null` — never throws — when the
 * caller belongs to no household yet or the query errors, so every caller
 * (recipes list/detail/create/edit screens) renders an honest empty state
 * instead of crashing. A genuinely shared helper: any later slice resolving
 * the same household should call this, not re-derive the rule.
 */
export const resolveHouseholdId = async (client: Client): Promise<string | null> => {
  const result = await client.query<MyHouseholdsQueryResult>(MY_HOUSEHOLDS_QUERY, {}).toPromise();

  if (result.error || !result.data) {
    return null;
  }

  return result.data.me.households[0]?.household.id ?? null;
};
