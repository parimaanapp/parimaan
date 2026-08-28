import { z } from 'zod';

/**
 * A hard client-side stop mirrored on the mobile paste screen (S10) so a
 * user never spends a rate-limit unit on input the server will reject
 * anyway (§13.2.9) — this is the authoritative, server-side copy of that
 * bound. Checked BEFORE the rate limiter and BEFORE any Gemini call: an
 * oversized paste is a validation failure, not a billable attempt
 * (§13.2.5's own "no Gemini call was made" cost-control test).
 */
export const MAX_FREEFORM_TEXT_LENGTH = 4000;

/**
 * Validates `Mutation.parseFreeformRecipe`'s only argument. `.trim().min(1)`
 * rejects both a genuinely empty string and a whitespace-only paste
 * identically — there is no meaningful "empty vs. whitespace" distinction
 * for a recipe to parse.
 */
export const parseFreeformRecipeArgsSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'text must not be empty')
    .max(MAX_FREEFORM_TEXT_LENGTH, `text must be at most ${MAX_FREEFORM_TEXT_LENGTH} characters`),
});

export type ParseFreeformRecipeArgs = z.infer<typeof parseFreeformRecipeArgsSchema>;
