import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { householdArgsSchema } from '../validation/household.js';
import { ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface OnMembershipRevokedResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: OnMembershipRevokedResolverDeps = { getPool };

/**
 * Subscribe-time Lambda resolver for `Subscription.onMembershipRevoked`
 * (D7, E2E_MVP_PLAN.md §17.2.7) — same per-field subscribe-time authorizer
 * shape as `onPantryChanged`/`onRecipeChanged`/`onHouseholdChanged`/
 * `onMenuChanged` (§11.2.9), reusing `requireHouseholdMember` unchanged: a
 * non-member or nonexistent `householdId` is denied identically, never an
 * existence oracle.
 *
 * This resolver fixes the subscribe-time-only re-authorization gap (§14,
 * row 14 of §17.1's forward-reference table) — not by re-checking a live
 * connection's authorization (AppSync provides no API for that, confirmed
 * while designing this slice), but by giving every *other* still-authorized
 * member of `householdId` a live, sub-second-latency signal the moment
 * `deleteHousehold` fires, so the client can react immediately rather than
 * wait for its own next reconnect/foreground cycle.
 *
 * `shared/schema.graphql`'s `onMembershipRevoked` is `@aws_subscribe`d to
 * `["deleteHousehold"]` ONLY — the only mutation in this codebase today
 * that instantly removes *other* members' access mid-session
 * (`leaveHousehold` is self-service and never attached here, for the exact
 * reason it is never attached to `onHouseholdChanged` either). This
 * resolver has no opinion on which mutations are wired to the field it
 * authorizes — that list lives entirely in the SDL's `@aws_subscribe`
 * directive; this function only gates the WebSocket subscribe call itself.
 *
 * As with every other subscribe-time authorizer, the pushed payload never
 * comes from this function's return value — it comes from `deleteHousehold`'s
 * own `Boolean!` response. Returning `null` is the standard AppSync
 * convention for a subscribe resolver that exists purely to gate the
 * connection.
 */
export const createOnMembershipRevokedHandler =
  (deps: OnMembershipRevokedResolverDeps) =>
  async (event: AppSyncResolverEvent<{ householdId: unknown }>): Promise<null> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = householdArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    await withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);
      },
      pool,
    );

    return null;
  };

// See `me.ts`'s identical comment: wraps only the exported production
// handler, not `createOnMembershipRevokedHandler`'s returned function.
export const handler = withErrorHandling(createOnMembershipRevokedHandler(productionDeps));
