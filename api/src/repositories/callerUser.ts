import type { Pool } from 'pg';
import type { CallerIdentity } from '../auth/identity.js';
import type { UserRow } from './userRepository.js';
import { upsertUserByCognitoSub } from './userRepository.js';
import { TtlCache } from '../cache/ttlCache.js';

const CALLER_USER_CACHE_TTL_MS = 30_000;

/**
 * Keyed on `cognitoSub` (E2E_MVP_PLAN.md §14.2.9, D3). `let`, not `const`:
 * only ever reassigned by {@link resetCallerUserCacheForTesting}, mirroring
 * `requireHouseholdMember.ts`'s `membershipCache` from W8 S5.
 */
let callerUserCache = new TtlCache<string, UserRow>(CALLER_USER_CACHE_TTL_MS);

/**
 * Resolves (upserting on first login) the caller's `users` row from a plain
 * pooled client — never `withUserTransaction`, since `users` has no RLS
 * policy and a single upsert statement doesn't need a transaction. Shared
 * by every resolver in this slice (`me`, `userHouseholds`,
 * `createHousehold`), which all previously duplicated this identical
 * connect/upsert/release sequence.
 *
 * Reads through a 30s, Lambda-container-local {@link TtlCache} to eliminate
 * an `INSERT … ON CONFLICT DO UPDATE` on every request (E2E_MVP_PLAN.md
 * §14.2.9, D3). Only a *successful* upsert is ever cached — `.set()` runs
 * after `upsertUserByCognitoSub` returns, never before or in place of a
 * throw — because caching a failure would lock a brand-new user out of their
 * own account creation for the rest of the TTL window.
 *
 * This does not weaken authorization: `identity.cognitoSub` is always the
 * freshly Lambda-verified value from this request's own AppSync event, never
 * read from the cache. The accepted tradeoff is purely a profile-freshness
 * one — `email`/`displayName`/`avatarUrl` returned to the caller may lag an
 * IdP-side change by up to 30s within the same warm container, mirroring the
 * ≤30s stale-window acceptance already documented for the membership cache
 * in `auth/requireHouseholdMember.ts` (W8 S5, D2 part 4).
 */
export const resolveCallerUser = async (pool: Pool, identity: CallerIdentity): Promise<UserRow> => {
  const cached = callerUserCache.get(identity.cognitoSub);
  if (cached !== undefined) {
    return cached;
  }

  const client = await pool.connect();
  let user: UserRow;
  try {
    user = await upsertUserByCognitoSub(client, identity);
  } finally {
    client.release();
  }
  callerUserCache.set(identity.cognitoSub, user);
  return user;
};

/**
 * Replaces the module-scope cache with a freshly-configured one — test-only,
 * mirroring `requireHouseholdMember.ts`'s `resetMembershipCacheForTesting`.
 * Lets a test supply a controllable `now` and a short `ttlMs` so TTL-expiry
 * behavior can be asserted deterministically and instantly, and guarantees
 * every test starts from an empty cache regardless of what an earlier test
 * in the same file left behind.
 */
export const resetCallerUserCacheForTesting = (options: { ttlMs?: number; now?: () => number } = {}): void => {
  callerUserCache = new TtlCache<string, UserRow>(options.ttlMs ?? CALLER_USER_CACHE_TTL_MS, options.now);
};
