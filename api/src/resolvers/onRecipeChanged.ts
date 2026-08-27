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

export interface OnRecipeChangedResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: OnRecipeChangedResolverDeps = { getPool };

/**
 * Subscribe-time Lambda resolver for `Subscription.onRecipeChanged` —
 * identical shape and reasoning to `onPantryChanged.ts` (E2E_MVP_PLAN.md
 * §12.3 S11, D6): AppSync invokes this once, at subscribe time, not per
 * pushed event; throwing here rejects the subscription outright, and a
 * non-member or nonexistent `householdId` deny identically
 * (`requireHouseholdMember`'s existing existence-oracle avoidance).
 *
 * The actual payload pushed to connected clients never comes from this
 * function's return value — it comes from whichever `@aws_subscribe`d
 * mutation's own response fired (`createRecipe`/`updateRecipe`/
 * `deleteRecipe`/`favoriteRecipe`/`setInRotation`). Returning `null` is the
 * standard AppSync convention for a subscribe resolver that exists purely
 * to gate the connection.
 */
export const createOnRecipeChangedHandler =
  (deps: OnRecipeChangedResolverDeps) =>
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
// handler, not `createOnRecipeChangedHandler`'s returned function.
export const handler = withErrorHandling(createOnRecipeChangedHandler(productionDeps));
