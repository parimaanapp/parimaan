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

export interface OnMenuChangedResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: OnMenuChangedResolverDeps = { getPool };

/**
 * Subscribe-time Lambda resolver for `Subscription.onMenuChanged`
 * (D9-carryover, E2E_MVP_PLAN.md §17.2.9) — same per-field subscribe-time
 * authorizer shape as `onPantryChanged`/`onRecipeChanged`/`onHouseholdChanged`
 * (§11.2.9), reusing `requireHouseholdMember` unchanged: a non-member or
 * nonexistent `householdId` deny identically, never an existence oracle.
 *
 * `shared/schema.graphql`'s `onMenuChanged` is `@aws_subscribe`d to
 * `["createMenu"]` ONLY (D9-carryover's own locked scope) — `addMenuItem`/
 * `removeMenuItem`/`autoFillWeek` all return actively-consumed non-`Menu`
 * shapes a D1-style widening would break at real cost, out of this week's
 * budget. This resolver has no opinion on which mutations are wired to the
 * field it authorizes — that list lives entirely in the SDL's
 * `@aws_subscribe` directive; this function only gates the WebSocket
 * subscribe call itself, identically regardless of which mutation later
 * pushes to it.
 *
 * As with every other subscribe-time authorizer, the pushed payload never
 * comes from this function's return value — it comes from `createMenu`'s
 * own response. Returning `null` is the standard AppSync convention for a
 * subscribe resolver that exists purely to gate the connection.
 */
export const createOnMenuChangedHandler =
  (deps: OnMenuChangedResolverDeps) =>
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
// handler, not `createOnMenuChangedHandler`'s returned function.
export const handler = withErrorHandling(createOnMenuChangedHandler(productionDeps));
