import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findMembershipsForUser } from '../repositories/householdRepository.js';
import { toGraphQLMembership } from '../mappers/household.js';
import type { GraphQLMembership } from '../mappers/household.js';
import { toGraphQLUser } from '../mappers/user.js';
import type { GraphQLUser } from '../mappers/user.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface UserHouseholdsResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: UserHouseholdsResolverDeps = { getPool };

/**
 * Field resolver for `User.households`. Exists specifically to break the
 * `User → HouseholdMembership → User` cycle: `Query.me` returns a flat
 * `User` with no `households` key, and this resolver runs separately
 * whenever a client actually selects `households` on some `User`.
 *
 * Authorization is re-derived from `event.identity` (the caller), never
 * trusted from `event.source.id` (the parent `User` being resolved) —
 * `source.id` is caller-influenceable data flowing through the GraphQL
 * response tree, not proof of who's asking. Only returns memberships when
 * the parent `User` IS the caller; returns `[]` (a soft "you can't see
 * this", not a `ForbiddenError`) otherwise — a future `household(id)` query
 * legitimately needs to show OTHER members' identities, this field isn't
 * that feature yet.
 */
export const createUserHouseholdsHandler =
  (deps: UserHouseholdsResolverDeps) =>
  async (
    event: AppSyncResolverEvent<Record<string, never>, { id: string } | null>,
  ): Promise<GraphQLMembership[]> => {
    const identity = extractCallerIdentity(event.identity);

    const pool = await deps.getPool();

    // `users` has no RLS policy, so (consistent with `me.ts`) this upsert
    // runs on a plain pooled client, not through `withUserTransaction`.
    const callerUser = await resolveCallerUser(pool, identity);

    const parentUser: GraphQLUser = toGraphQLUser(callerUser);

    if (event.source === null || event.source.id !== callerUser.id) {
      return [];
    }

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const memberships = await findMembershipsForUser(client, callerUser.id);
        return memberships.map((membership) => toGraphQLMembership(membership, parentUser));
      },
      pool,
    );
  };

// See `me.ts`'s identical comment: wraps only the exported production
// handler, not `createUserHouseholdsHandler`'s returned function.
export const handler = withErrorHandling(createUserHouseholdsHandler(productionDeps));
