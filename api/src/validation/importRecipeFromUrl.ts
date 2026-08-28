import { z } from 'zod';

/** A generous cap against a pathological input — genuine URL length, not the SSRF gate (that's `net/safeUrl.ts`'s own job, kept deliberately separate). */
export const MAX_URL_LENGTH = 2048;

export const importRecipeFromUrlArgsSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'url must not be empty')
    .max(MAX_URL_LENGTH, `url must be at most ${MAX_URL_LENGTH} characters`),
});

export type ImportRecipeFromUrlArgs = z.infer<typeof importRecipeFromUrlArgsSchema>;
