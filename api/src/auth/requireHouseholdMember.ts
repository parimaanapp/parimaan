import type { PoolClient } from 'pg';
import { ForbiddenError } from '../errors.js';
import { findMembership } from '../repositories/householdRepository.js';
import type { HouseholdRole } from '../repositories/householdRepository.js';

/**
 * Deliberately identical whether the household doesn't exist at all or the
 * caller simply isn't a member of it — `findMembership` itself can't (and
 * shouldn't) distinguish those two cases either. Returning different
 * messages would turn this into a household-existence oracle: an attacker
 * could enumerate arbitrary UUIDs and learn which ones are real households
 * purely from the error text, without ever needing a valid invite code.
 */
const DENIAL_MESSAGE = 'You are not a member of this household.';

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
 * No membership-decision caching in this slice (a future 30s TTL cache is
 * explicitly deferred, per SD §10.3) — this queries the database on every
 * call.
 */
export const requireHouseholdMember = async (
  client: PoolClient,
  userId: string,
  householdId: string,
): Promise<HouseholdRole> => {
  const membership = await findMembership(client, householdId, userId);
  if (membership === null) {
    throw new ForbiddenError(DENIAL_MESSAGE);
  }
  return membership.role;
};
