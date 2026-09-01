import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { toGraphQLUser } from '../mappers/user.js';
import type { GraphQLUser } from '../mappers/user.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface MeResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: MeResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.me`: extracts and validates the caller's
 * Cognito identity, resolves their `users` row via `resolveCallerUser`
 * (first-login upserts it; a login within the caller-identity cache's 30s
 * TTL — W8 S6, `repositories/callerUser.ts` — is served the cached row
 * rather than re-upserting), and returns the mapped `User` — deliberately
 * without a `households` key (see `resolvers/userHouseholds.ts`, the
 * separate field resolver that breaks the User↔HouseholdMembership↔User
 * cycle).
 *
 * `users` has no RLS policy, so this intentionally does NOT go through
 * `withUserTransaction` — a plain pooled client is sufficient and avoids an
 * unnecessary transaction for a single upsert statement.
 */
export const createMeHandler =
  (deps: MeResolverDeps) =>
  async (event: AppSyncResolverEvent<Record<string, never>>): Promise<GraphQLUser> => {
    const identity = extractCallerIdentity(event.identity);

    const pool = await deps.getPool();
    const row = await resolveCallerUser(pool, identity);
    return toGraphQLUser(row);
  };

// Wraps the exported production handler only, not `createMeHandler`'s
// returned function itself — existing unit tests construct their own
// handler via `createMeHandler(deps)` directly and assert on the original
// typed errors (`UnauthorizedError`, etc.); this is what AppSync actually
// invokes, and is where a raw/unanticipated error must be sanitized before
// it can reach the GraphQL client. See `withErrorHandling.ts`.
export const handler = withErrorHandling(createMeHandler(productionDeps));
