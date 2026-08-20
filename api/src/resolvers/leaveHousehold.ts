import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  deleteNonPrimaryMembership as deleteNonPrimaryMembershipRepo,
  findMembership as findMembershipRepo,
} from '../repositories/householdRepository.js';
import { leaveHouseholdArgsSchema } from '../validation/leaveHousehold.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

/**
 * The primary member cannot walk away and leave a household primary-less.
 * Naming `deleteHousehold` in the message is deliberate: it is the only
 * sanctioned exit for a primary in this slice (primary-role transfer is
 * post-MVP, per PRD §7.1), and a bare "you can't do that" would leave the
 * caller with no next step.
 */
const PRIMARY_CANNOT_LEAVE_MESSAGE =
  'The primary member cannot leave a household. Delete the household instead.';

export interface LeaveHouseholdResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `findMembership`'s own signature — used to force the role pre-check to report a stale answer. */
  findMembership?: typeof findMembershipRepo;
  /** Injectable seam matching `deleteNonPrimaryMembership`'s own signature — used to force the lost-race (`null`) outcome. */
  deleteNonPrimaryMembership?: typeof deleteNonPrimaryMembershipRepo;
}

export const productionDeps: LeaveHouseholdResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.leaveHousehold`. Flow: validate
 * identity → validate `{ householdId }` → resolve/upsert the caller's `users`
 * row → within a single `withUserTransaction` scope: look up the caller's
 * membership, then either succeed idempotently, refuse (primary), or delete.
 *
 * DELIBERATELY NOT gated by `requireHouseholdMember`, unlike every other
 * household-scoped resolver in this codebase. "You are not a member" is the
 * *desired end state* of this mutation, so a non-member calling it has
 * already got what they asked for — returning `true` is the correct answer,
 * not a denial. Making it a `ForbiddenError` instead would also make repeated
 * calls (a client retry, a double-tap) fail after the first success, and
 * would leak household existence to nobody's benefit. The one thing that IS
 * refused is the primary leaving, and that check reads the caller's own
 * membership row — it is not an authorization gate on someone else's data.
 *
 * Deliberately NOT rate-limited: there is no guessable credential in play
 * (the caller can only ever affect their own membership row), so the abuse
 * shape `joinHousehold`/`rotateInviteCode` are limited against does not
 * exist here.
 */
export const createLeaveHouseholdHandler =
  (deps: LeaveHouseholdResolverDeps) =>
  async (event: AppSyncResolverEvent<{ householdId: unknown }>): Promise<boolean> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = leaveHouseholdArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const findMembership = deps.findMembership ?? findMembershipRepo;
        const membership = await findMembership(client, householdId, callerUser.id);

        // Not a member (or the household doesn't exist — indistinguishable,
        // and identically successful). Nothing to delete; already done.
        if (membership === null) {
          return true;
        }

        if (membership.role === 'primary') {
          // Return before the delete, not after a no-op one: the membership
          // row must survive this branch completely untouched.
          throw new ForbiddenError(PRIMARY_CANNOT_LEAVE_MESSAGE);
        }

        const deleteNonPrimaryMembership =
          deps.deleteNonPrimaryMembership ?? deleteNonPrimaryMembershipRepo;
        // A `null` here means a concurrent call already removed the row
        // between the pre-check and this statement. That is still "you are
        // not a member of this household", which is exactly what the caller
        // asked for — success, not an error.
        await deleteNonPrimaryMembership(client, householdId, callerUser.id);
        return true;
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createLeaveHouseholdHandler`'s returned function.
export const handler = withErrorHandling(createLeaveHouseholdHandler(productionDeps));
