import type { PoolClient } from 'pg';
import { ForbiddenError } from '../errors.js';
import { findMembership } from '../repositories/householdRepository.js';
import type { HouseholdRole } from '../repositories/householdRepository.js';
import { TtlCache } from '../cache/ttlCache.js';

/**
 * Deliberately identical whether the household doesn't exist at all or the
 * caller simply isn't a member of it — `findMembership` itself can't (and
 * shouldn't) distinguish those two cases either. Returning different
 * messages would turn this into a household-existence oracle: an attacker
 * could enumerate arbitrary UUIDs and learn which ones are real households
 * purely from the error text, without ever needing a valid invite code.
 */
/**
 * Exported so a resolver that must resolve `householdId` from some other
 * id first (e.g. `addMenuItem`/`removeMenuItem` from a `menuId`/menu-item
 * `id`, which have no `householdId` argument of their own) can throw the
 * byte-identical denial when that lookup itself comes back empty — keeping
 * "doesn't exist" and "not a member" indistinguishable even one hop away
 * from this function's own direct callers.
 */
export const DENIAL_MESSAGE = 'You are not a member of this household.';

const MEMBERSHIP_CACHE_TTL_MS = 30_000;

/**
 * Keyed on **both** `userId` and `householdId` (E2E_MVP_PLAN.md §14.2.8, D2)
 * — a user's membership in one household must never authorize a different
 * one just because both happen to share a cache. `let`, not `const`: only
 * ever reassigned by {@link resetMembershipCacheForTesting}, so a test can
 * swap in a controllable clock and a short TTL without the production path
 * needing to know either exists.
 */
let membershipCache = new TtlCache<string, HouseholdRole>(MEMBERSHIP_CACHE_TTL_MS);

/**
 * The `:` delimiter is only collision-safe because both inputs are always
 * UUIDs (`users.id`/`households.id`, both `UUID PRIMARY KEY DEFAULT
 * gen_random_uuid()`, and every GraphQL entry point validates `householdId`
 * through a `.uuid()` Zod schema before it reaches this function) — neither
 * can ever contain a `:`. A future caller passing a non-UUID identifier
 * through this same path would need a different, collision-safe encoding.
 */
const membershipCacheKey = (userId: string, householdId: string): string => `${userId}:${householdId}`;

/**
 * The primary (layer 2) authorization gate for every household-scoped
 * resolver in this slice — `updateHouseholdSettings` and every future
 * household-scoped mutation/query should call this first, inside their
 * `withUserTransaction` scope, before touching any household-scoped table.
 * `household_settings`'s own RLS policy (layer 3) is defense-in-depth on top
 * of this, not a substitute for it — RLS alone would still let a caller's
 * query silently return zero rows rather than a clear, typed
 * `ForbiddenError`, and future RLS-less household-scoped tables (like plain
 * `households` itself) have no layer-3 protection at all.
 *
 * Reads through a 30s, Lambda-container-local, in-memory {@link TtlCache}
 * (E2E_MVP_PLAN.md §14.2.8, D2 — locked, four parts, all implemented here):
 *
 * 1. **Positive results only.** A denial (a `null` membership) is never
 *    cached — a member who has *just* joined must not be locked out for 30s.
 * 2. **`options.bypassCache`** lets the membership-mutating/destructive
 *    resolvers (`joinHousehold`, `leaveHousehold`, `deleteHousehold`,
 *    `rotateInviteCode`) always read live rather than a possibly-stale
 *    cached role. `deleteHousehold`/`rotateInviteCode` are this function's
 *    only current callers among those four; `joinHousehold`/`leaveHousehold`
 *    don't call this at all today (`joinHousehold` has no gate at all —
 *    the caller is by definition not yet a member — and `leaveHousehold` is
 *    deliberately ungated too), but the option exists so either can start
 *    calling this safely without a second review of this function.
 * 3. **{@link evictMembershipCache}** — those same four resolvers call it
 *    after a successful mutation, best-effort and container-local only (it
 *    cannot reach other warm containers).
 * 4. **The ≤30s stale-authorization window is accepted, in writing**: for
 *    every RLS-protected table this gate guards, a stale pass here still
 *    hits a live RLS check at the query itself; the genuine gap is
 *    `households`/`household_memberships` themselves, which have no RLS of
 *    their own and rely on this function as their only gate.
 */
export const requireHouseholdMember = async (
  client: PoolClient,
  userId: string,
  householdId: string,
  options: { bypassCache?: boolean } = {},
): Promise<HouseholdRole> => {
  const key = membershipCacheKey(userId, householdId);
  if (options.bypassCache !== true) {
    const cached = membershipCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
  }

  const membership = await findMembership(client, householdId, userId);
  if (membership === null) {
    throw new ForbiddenError(DENIAL_MESSAGE);
  }
  membershipCache.set(key, membership.role);
  return membership.role;
};

/**
 * Best-effort local invalidation (D2 part 3) — call after any successful
 * membership mutation for `(userId, householdId)`. Partial by construction:
 * it only ever reaches this Lambda execution environment's own cache, never
 * other warm containers, which is exactly the accepted ≤30s window D2 part
 * 4 documents. A no-op if there was nothing cached for this pair.
 *
 * Every current call site invokes this *inside* its own `withUserTransaction`
 * scope, before that transaction commits — optimistic, not post-commit. The
 * failure mode this leaves is strictly conservative (a commit that somehow
 * still fails after this call leaves the cache cleared for a mutation that
 * never took effect, costing one extra live DB read on the next call — never
 * a stale-positive cache hit), and `withUserTransaction` today runs at
 * READ COMMITTED with no retry-on-conflict, so the gap is theoretical rather
 * than observed. Worth revisiting if that ever changes.
 */
export const evictMembershipCache = (userId: string, householdId: string): void => {
  membershipCache.delete(membershipCacheKey(userId, householdId));
};

/**
 * Replaces the module-scope cache with a freshly-configured one — test-only,
 * mirroring `db/pool.ts`'s `resetPoolForTesting`. Lets a test supply a
 * controllable `now` and a short `ttlMs` so TTL-expiry behavior can be
 * asserted deterministically and instantly, without a real 30-second sleep,
 * and guarantees every test starts from an empty cache regardless of what an
 * earlier test in the same file left behind.
 */
export const resetMembershipCacheForTesting = (options: { ttlMs?: number; now?: () => number } = {}): void => {
  membershipCache = new TtlCache<string, HouseholdRole>(options.ttlMs ?? MEMBERSHIP_CACHE_TTL_MS, options.now);
};
