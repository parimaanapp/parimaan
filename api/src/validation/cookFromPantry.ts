import { z } from 'zod';
import { COOK_VIBE_VALUES } from '../../prompts/cookFromPantry.js';
import { householdIdSchema } from './householdId.js';

/**
 * Validates `Mutation.cookFromPantry`'s arguments (W21 S3). `vibe` is a closed
 * enum, never free text (D11): the only text it can contribute to the prompt is
 * the fixed phrase table, and here it is validated a second time, after
 * AppSync's own enum check, so a direct invoke or a future schema change cannot
 * smuggle a string (including a prototype key such as "constructor") past it.
 * `.nullish()` because a Ferry client sends an explicit `null` for an unset
 * nullable variable; both mean "any vibe".
 */
export const cookFromPantryArgsSchema = z.object({
  // Lowercased: the uuid check accepts either case, but the cache key must be one string per household.
  householdId: householdIdSchema.transform((id) => id.toLowerCase()),
  vibe: z
    .enum(COOK_VIBE_VALUES)
    .nullish()
    .transform((vibe) => vibe ?? null),
});
