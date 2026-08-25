import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

const MAX_SEARCH_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 40;

/**
 * Validates `Query.pantry`'s arguments. `search`/`category` are both
 * optional filters — an absent value means "no filter", not an empty-string
 * one. Length caps here are abuse-prevention (an unbounded string reaching
 * a `LIKE` clause), not the unit/category canonicalisation itself, which
 * happens separately (`domain/pantryCategories.ts`) and only for
 * `addPantryItem`'s write path — a read-side filter is compared as typed,
 * so a client filtering by an already-canonical category value (as
 * returned by a previous read) still matches.
 */
export const pantryArgsSchema = z.object({
  householdId: householdIdSchema,
  search: z.string().trim().max(MAX_SEARCH_LENGTH, `search must be at most ${MAX_SEARCH_LENGTH} characters`).optional(),
  category: z
    .string()
    .trim()
    .max(MAX_CATEGORY_LENGTH, `category must be at most ${MAX_CATEGORY_LENGTH} characters`)
    .optional(),
});

export type PantryArgs = z.infer<typeof pantryArgsSchema>;
