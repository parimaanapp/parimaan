import 'server-only';
import { MY_HOUSEHOLDS_QUERY, type MyHouseholdsQueryResult } from './queries';
import { createServerUrqlClient } from './serverClient';

/**
 * W18 D3's household resolution, server-side: "the web dashboard resolves
 * `me.households[0]`... as the active household for the whole session"
 * (`docs/E2E_MVP_PLAN.md` §24.2.3) — no switcher. This is the first slice
 * in this worktree to need a household id at all (S3 only ever called
 * `Query.me`), so there is no existing helper to reuse yet; written so a
 * later settings/dashboard/recipes merge can adopt this one helper instead
 * of each screen re-deriving the same "first membership" rule.
 *
 * Throws, rather than returning `null`, when the caller belongs to no
 * household — every account created via the app's own onboarding flow
 * already has one (W4's `createHousehold`), so this is a genuine invariant
 * violation, not a normal empty state; it surfaces as a Next.js error
 * boundary rather than a silently broken settings form.
 */
export const resolveHouseholdId = async (idToken: string): Promise<string> => {
  const client = createServerUrqlClient(idToken);
  const result = await client.query<MyHouseholdsQueryResult>(MY_HOUSEHOLDS_QUERY, {}).toPromise();

  if (result.error) {
    throw result.error;
  }

  const householdId = result.data?.me.households[0]?.household.id;
  if (!householdId) {
    throw new Error('This account has no household yet.');
  }
  return householdId;
};
