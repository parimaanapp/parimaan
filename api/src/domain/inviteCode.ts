import { randomInt as nodeRandomInt } from 'node:crypto';

/**
 * Household invite codes are a guessable-token surface (anyone who has one
 * can join a household) — length and alphabet are a deliberate security
 * choice, not incidental. 6 characters over a 31-character alphabet is
 * 31^6 ≈ 887M possible codes, and every character is generated via
 * `crypto.randomInt`'s rejection sampling (never `Math.random`, which is not
 * cryptographically secure). That keyspace is adequate for uniqueness
 * (the invite-code-collision retry logic in `resolvers/createHousehold.ts`
 * exists for exactly this reason) but is NOT on its own an adequate defense
 * for an unrate-limited join credential — whichever mutation consumes this
 * code to join a household MUST add rate limiting before it ships; the
 * keyspace alone is not sufficient against a scripted guessing attack.
 */
export const INVITE_CODE_LENGTH = 6;

/**
 * 31 characters: uppercase letters + digits, minus `0/O/1/I/L` — characters
 * that are ambiguous when read aloud or hand-typed by a household member
 * sharing this code verbally or on paper.
 */
export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export type RandomIntFn = (min: number, max: number) => number;

/**
 * Generates one household invite code. `randomInt` is injectable for
 * deterministic tests; defaults to Node's `crypto.randomInt`, which performs
 * rejection sampling internally so `randomInt(0, alphabet.length)` is
 * uniform over `[0, alphabet.length)` with zero modulo bias.
 */
export const generateInviteCode = (randomInt: RandomIntFn = nodeRandomInt): string => {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    const index = randomInt(0, INVITE_CODE_ALPHABET.length);
    code += INVITE_CODE_ALPHABET[index];
  }
  return code;
};
