import type { AppSyncResolverEvent } from 'aws-lambda';
import type { Pool } from 'pg';
import { extractCallerIdentity } from '../auth/identity.js';
import { requireHouseholdMember } from '../auth/requireHouseholdMember.js';
import { getPool } from '../db/pool.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { resolveCallerUser } from '../repositories/callerUser.js';
import {
  deleteHousehold as deleteHouseholdRepo,
  findHouseholdById,
} from '../repositories/householdRepository.js';
import { deleteHouseholdArgsSchema } from '../validation/deleteHousehold.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { withErrorHandling } from './withErrorHandling.js';

const NOT_PRIMARY_MESSAGE = 'Only the primary member can delete a household.';

/**
 * Deliberately says nothing about what the real name is, or how close the
 * attempt was — the point of the gate is that the caller already knows the
 * name they are destroying.
 */
const CONFIRMATION_MISMATCH_MESSAGE = 'confirmationName must exactly match the household name.';

export interface DeleteHouseholdResolverDeps {
  getPool: () => Promise<Pool>;
  /** Injectable seam matching `deleteHousehold`'s own signature, for forced-failure/rollback tests. */
  deleteHousehold?: typeof deleteHouseholdRepo;
}

export const productionDeps: DeleteHouseholdResolverDeps = { getPool };

/**
 * Direct-Lambda resolver for `Mutation.deleteHousehold`. Flow: validate
 * identity → validate `{ householdId, confirmationName }` → resolve/upsert
 * the caller's `users` row → within a single `withUserTransaction` scope:
 * `requireHouseholdMember` → primary-only role check → exact-name
 * confirmation → delete.
 *
 * Unlike `leaveHousehold`, this one IS gated by `requireHouseholdMember`:
 * "not authorized to delete this household" is the correct semantics for a
 * non-member, not an idempotent success. That also settles the nonexistent-
 * household case by construction — `findMembership` cannot distinguish
 * "no such household" from "not a member", so both produce the identical
 * `ForbiddenError`, and this mutation never becomes a household-existence
 * oracle (see `auth/requireHouseholdMember.ts`'s own comment).
 *
 * `requireHouseholdMember` returns only the caller's `HouseholdRole`, not the
 * household row, so the name needed for the confirmation check costs one
 * `findHouseholdById` — there is no cheaper path through the existing gate.
 *
 * This is the only sanctioned way a household ever becomes fully memberless.
 * The dependent `household_memberships`/`household_settings` rows go with it
 * via `ON DELETE CASCADE` — see the repository function's own comment, and
 * the standing note in `docs/RUNBOOK.md` about future household-scoped tables
 * that will not cascade on their own.
 */
export const createDeleteHouseholdHandler =
  (deps: DeleteHouseholdResolverDeps) =>
  async (
    event: AppSyncResolverEvent<{ householdId: unknown; confirmationName: unknown }>,
  ): Promise<boolean> => {
    const identity = extractCallerIdentity(event.identity);

    const parsedArgs = deleteHouseholdArgsSchema.safeParse(event.arguments);
    if (!parsedArgs.success) {
      throw new ValidationError(parsedArgs.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { householdId, confirmationName } = parsedArgs.data;

    const pool = await deps.getPool();
    const callerUser = await resolveCallerUser(pool, identity);

    return withUserTransaction(
      callerUser.id,
      async (client) => {
        const role = await requireHouseholdMember(client, callerUser.id, householdId);
        if (role !== 'primary') {
          throw new ForbiddenError(NOT_PRIMARY_MESSAGE);
        }

        const household = await findHouseholdById(client, householdId);
        if (household === null) {
          // Unreachable: membership rows FK-reference households, so
          // requireHouseholdMember passing implies the row exists.
          throw new NotFoundError('Household not found.');
        }

        // Exact match: case-sensitive, no trimming, no normalization. Throws
        // before anything is deleted.
        if (confirmationName !== household.name) {
          throw new ValidationError(CONFIRMATION_MISMATCH_MESSAGE);
        }

        const deleteHousehold = deps.deleteHousehold ?? deleteHouseholdRepo;
        await deleteHousehold(client, householdId);
        return true;
      },
      pool,
    );
  };

// See `createHousehold.ts`'s identical comment: wraps only the exported
// production handler, not `createDeleteHouseholdHandler`'s returned function.
export const handler = withErrorHandling(createDeleteHouseholdHandler(productionDeps));
