import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

/** Validates `Query.household`'s `{ householdId: ID! }` argument. */
export const householdArgsSchema = z.object({
  householdId: householdIdSchema,
});

export type HouseholdArgs = z.infer<typeof householdArgsSchema>;
