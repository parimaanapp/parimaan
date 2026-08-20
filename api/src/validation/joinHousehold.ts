import { z } from 'zod';
import { INVITE_CODE_LENGTH } from '../domain/inviteCode.js';

/**
 * Validates `Mutation.joinHousehold`'s `{ inviteCode: String! }` argument.
 * Trims and uppercases first — `domain/inviteCode.ts`'s alphabet is
 * uppercase-only, and a household member sharing a code verbally/on paper
 * shouldn't have to worry about a client normalizing case before sending it.
 * Enforces the exact generated length; anything else can never match a real
 * household and would otherwise reach the database only to fail a lookup.
 */
export const joinHouseholdArgsSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .length(INVITE_CODE_LENGTH, `inviteCode must be exactly ${INVITE_CODE_LENGTH} characters`),
});

export type JoinHouseholdArgs = z.infer<typeof joinHouseholdArgsSchema>;
