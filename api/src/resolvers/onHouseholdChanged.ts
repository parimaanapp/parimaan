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

export interface OnHouseholdChangedResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: OnHouseholdChangedResolverDeps = { getPool };

/**
 * Subscribe-time Lambda resolver for `Subscription.onHouseholdChanged` —
 * identical shape and reasoning to `onPantryChanged.ts`/`onRecipeChanged.ts`
 * (E2E_MVP_PLAN.md §14.2.10, D4/D5, W8 S10): AppSync invokes this once, at
 * subscribe time, not per pushed event; throwing here rejects the
 * subscription outright, and a non-member or nonexistent `householdId` deny
 * identically (`requireHouseholdMember`'s existing existence-oracle
 * avoidance).
 *
 * The actual payload pushed to connected clients never comes from this
 * function's return value — it comes from whichever `@aws_subscribe`d
 * mutation's own response fired (`joinHousehold`/`rotateInviteCode`/
 * `updateHouseholdSettings`). Returning `null` is the standard AppSync
 * convention for a subscribe resolver that exists purely to gate the
 * connection.
 *
 * Deliberately reads through the membership cache (W8 S5) like every other
 * subscribe-time authorizer — this is the standing "authorize once, hold for
 * connection life" window §14.2.8's closing note already flags, not a new
 * gap this resolver introduces.
 */
export const createOnHouseholdChangedHandler =
  (deps: OnHouseholdChangedResolverDeps) =>
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
// handler, not `createOnHouseholdChangedHandler`'s returned function.
export const handler = withErrorHandling(createOnHouseholdChangedHandler(productionDeps));
