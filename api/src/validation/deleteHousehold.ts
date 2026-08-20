import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

/**
 * Validates `Mutation.deleteHousehold`'s arguments. `confirmationName` is
 * only checked here for *presence* — the exact, case-sensitive,
 * whitespace-sensitive comparison against the household's real name happens
 * in the resolver, because only that layer knows the name. Deliberately no
 * `.trim()`: this is a "type the exact name" confirmation gate on an
 * irreversible, cascading delete, and silently normalizing the input would
 * weaken the very thing it exists to prove.
 */
export const deleteHouseholdArgsSchema = z.object({
  householdId: householdIdSchema,
  confirmationName: z.string().min(1, 'confirmationName must not be empty'),
});

export type DeleteHouseholdArgs = z.infer<typeof deleteHouseholdArgsSchema>;
