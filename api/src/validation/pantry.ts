import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

const MAX_SEARCH_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 40;

/**
 * Validates `Query.pantry`'s arguments. `search`/`category` are both
 * optional filters — an absent value means "no filter", not an empty-string
 * one. `.nullish()`, not `.optional()`: a GraphQL nullable argument
 * (`search: String`) that the client never set arrives here as an explicit
 * `null`, not a missing key — confirmed against the real AppSync wire
 * behavior (a Ferry client always serializes every declared variable, `null`
 * included) after `.optional()` alone made every unfiltered `Query.pantry`
 * call fail validation in production while every unit test — which only
 * ever passed `undefined`, never `null`, for the no-filter case — stayed
 * green. Length caps here are abuse-prevention (an unbounded string
 * reaching a `LIKE` clause), not the unit/category canonicalisation itself,
 * which happens separately (`domain/pantryCategories.ts`) and only for
 * `addPantryItem`'s write path — a read-side filter is compared as typed,
 * so a client filtering by an already-canonical category value (as
 * returned by a previous read) still matches.
 */
export const pantryArgsSchema = z.object({
  householdId: householdIdSchema,
  search: z.string().trim().max(MAX_SEARCH_LENGTH, `search must be at most ${MAX_SEARCH_LENGTH} characters`).nullish(),
  category: z
    .string()
    .trim()
    .max(MAX_CATEGORY_LENGTH, `category must be at most ${MAX_CATEGORY_LENGTH} characters`)
    .nullish(),
});

export type PantryArgs = z.infer<typeof pantryArgsSchema>;
