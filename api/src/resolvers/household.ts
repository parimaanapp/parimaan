import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import { findHouseholdById } from '../repositories/householdRepository.js';
import type { GraphQLHousehold } from '../mappers/household.js';
import { householdArgsSchema } from '../validation/household.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { buildGraphQLHousehold } from './householdView.js';
import { withErrorHandling } from './withErrorHandling.js';

export interface HouseholdResolverDeps {
  getPool: () => Promise<Pool>;
}

export const productionDeps: HouseholdResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Query.household`. Exists specifically because
 * `me { households { household { members } } }` deliberately returns each
 * membership's household with an empty `members` list (see
 * `mappers/household.ts`'s `toGraphQLMembership` — a recursion cutoff, not a
 * bug), so the Members list screen and any future poll-based refresh (W4's
 * `HouseholdSyncPolicy`, in lieu of the subscription deferred to W12) need a
 * separate query that actually hydrates members. Reuses `buildGraphQLHousehold`
 * so this returns a byte-identical shape to `joinHousehold`/`rotateInviteCode`.
 *
 * Gated by `requireHouseholdMember` first — same identical-denial-message
 * property as every other household-scoped resolver, so this can't be used
 * as a household-existence oracle for arbitrary UUIDs.
 */
export const createHouseholdHandler =
  (deps: HouseholdResolverDeps) =>
  async (event: AppSyncResolverEvent<{ householdId: unknown }>): Promise<GraphQLHousehold> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = householdArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        await requireHouseholdMember(client, callerUser.id, householdId);

        const household = await findHouseholdById(client, householdId);
        if (household === null) {
          // Narrow, harmless TOCTOU window, not provably unreachable — see
          // the identical comment in rotateInviteCode.ts for the full
          // reasoning (READ COMMITTED's per-statement snapshots mean the FK
          // guarantee doesn't span the rest of this transaction). Falling
          // through to NotFoundError here is the correct, safe response.
          throw new NotFoundError('Household not found.');
        }

        return buildGraphQLHousehold(client, household);
      },
      pool,
    );
  };

// See `me.ts`'s identical comment: wraps only the exported production
// handler, not `createHouseholdHandler`'s returned function.
export const handler = withErrorHandling(createHouseholdHandler(productionDeps));
