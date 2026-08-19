import { z } from 'zod';

const MAX_NAME_LENGTH = 60;

/**
 * Rejects ASCII control characters (0x00-0x1F, 0x7F) — a household name is
 * displayed as-is in the UI, and control characters (tabs, newlines,
 * escape sequences) have no legitimate reason to appear there. Unicode
 * (emoji, non-Latin scripts) is intentionally allowed — Indian-kitchen
 * households commonly name themselves in Hindi/regional scripts.
 */
const hasControlCharacters = (value: string): boolean =>
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, see comment above.
  /[\x00-\x1F\x7F]/.test(value);

/**
 * Validates `Mutation.createHousehold`'s `{ name: String! }` argument at
 * the AppSync → Lambda boundary — untrusted input per the coding-style
 * rule. Trims first (so a client-side leading/trailing space doesn't count
 * against the length limit or trigger the empty-after-trim rejection), then
 * enforces non-empty and a 60-character cap.
 */
export const createHouseholdArgsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name must not be empty')
    .max(MAX_NAME_LENGTH, `name must be at most ${MAX_NAME_LENGTH} characters`)
    .refine((value) => !hasControlCharacters(value), 'name must not contain control characters'),
});

export type CreateHouseholdArgs = z.infer<typeof createHouseholdArgsSchema>;
