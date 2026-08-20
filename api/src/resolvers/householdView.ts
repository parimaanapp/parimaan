import type { PoolClient } from 'pg';
import {
  findMembersForHousehold,
  findSettingsForHousehold,
} from '../repositories/householdRepository.js';
import type { HouseholdRow } from '../repositories/householdRepository.js';
import { toGraphQLHousehold, toGraphQLHouseholdMember } from '../mappers/household.js';
import type { GraphQLHousehold } from '../mappers/household.js';
import { NotFoundError } from '../errors.js';

/**
 * Hydrates an already-fetched `households` row into the full GraphQL
 * `Household` shape — its settings plus every member joined to that member's
 * own `users` row. Shared by every household-scoped mutation that returns a
 * `Household!` (`joinHousehold`, `rotateInviteCode`) so they all produce a
 * byte-identical response shape rather than each assembling their own.
 *
 * Must run inside a `withUserTransaction(userId, ...)` scope whose user is a
 * member: `household_settings` is RLS-protected, so a non-member's read
 * returns zero rows and surfaces here as `NotFoundError`. Callers gate on
 * `requireHouseholdMember` first (or, for `joinHousehold`, have just created
 * the membership), so that branch is defensive rather than the real
 * authorization boundary.
 */
export const buildGraphQLHousehold = async (
  client: PoolClient,
  household: HouseholdRow,
): Promise<GraphQLHousehold> => {
  const settings = await findSettingsForHousehold(client, household.id);
  if (settings === null) {
    throw new NotFoundError('Household settings not found.');
  }
  const memberRows = await findMembersForHousehold(client, household.id);
  const members = memberRows.map((row) => toGraphQLHouseholdMember(row, household, settings));
  return toGraphQLHousehold(household, members, settings);
};
