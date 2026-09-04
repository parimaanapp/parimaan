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

export interface OnShoppingListChangedResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: OnShoppingListChangedResolverDeps = { getPool };

/**
 * Subscribe-time Lambda resolver for `Subscription.onShoppingListChanged`
 * (D1, E2E_MVP_PLAN.md §18.2.1, W12 S3 — cashing in W11 D1's own promise,
 * §17.2.1) — same per-field subscribe-time authorizer shape as every other
 * subscription in this schema (`onPantryChanged`/`onRecipeChanged`/
 * `onHouseholdChanged`/`onMenuChanged`), reusing `requireHouseholdMember`
 * unchanged: a non-member or nonexistent `householdId` deny identically,
 * never an existence oracle.
 *
 * `shared/schema.graphql`'s `onShoppingListChanged` is `@aws_subscribe`d
 * to `["generateShoppingList", "regenerateShoppingList", "haveIt",
 * "markPurchased"]` (D1's own locked mutation list) — this resolver has no
 * opinion on which mutations are wired to the field it authorizes, the
 * same separation of concerns `onMenuChanged`'s own doc already
 * establishes: that list lives entirely in the SDL's `@aws_subscribe`
 * directive; this function only gates the WebSocket subscribe call
 * itself, identically regardless of which mutation later pushes to it.
 *
 * As with every other subscribe-time authorizer, the pushed payload never
 * comes from this function's return value — it comes from whichever
 * attached mutation's own response. Returning `null` is the standard
 * AppSync convention for a subscribe resolver that exists purely to gate
 * the connection.
 */
export const createOnShoppingListChangedHandler =
  (deps: OnShoppingListChangedResolverDeps) =>
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
// handler, not `createOnShoppingListChangedHandler`'s returned function.
export const handler = withErrorHandling(createOnShoppingListChangedHandler(productionDeps));
