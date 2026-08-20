import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

/**
 * Validates `Mutation.rotateInviteCode`'s `{ householdId: ID! }` argument.
 * The replacement code is never client-supplied — it is minted server-side
 * (`domain/inviteCode.ts`), so there is deliberately nothing else to
 * validate here.
 */
export const rotateInviteCodeArgsSchema = z.object({
  householdId: householdIdSchema,
});

export type RotateInviteCodeArgs = z.infer<typeof rotateInviteCodeArgsSchema>;
