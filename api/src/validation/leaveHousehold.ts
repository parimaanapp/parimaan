import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

/**
 * Validates `Mutation.leaveHousehold`'s `{ householdId: ID! }` argument.
 * There is no "which member" argument by design — the departing member is
 * always the caller, derived from `identity.sub`, never from input.
 */
export const leaveHouseholdArgsSchema = z.object({
  householdId: householdIdSchema,
});

export type LeaveHouseholdArgs = z.infer<typeof leaveHouseholdArgsSchema>;
