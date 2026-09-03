import { z } from 'zod';

/**
 * `Mutation.haveIt`'s arguments (W11 S3, E2E_MVP_PLAN.md §17.3). `quantity`
 * is required and strictly positive — `z.number()` already rejects an
 * explicit `null`/absent value (no `.nullish()`, matching
 * `regenerateShoppingListArgsSchema.confirmed`'s "genuine two-valued
 * instruction with no leave-unchanged reading" precedent), and
 * `.positive()` rejects zero/negative at validation, before the mutation's
 * transaction ever opens — a "buy 0" or "buy -2" confirmation is a client
 * bug, never a valid have-it.
 */
export const haveItArgsSchema = z.object({
  itemId: z.string().uuid('itemId must be a valid UUID'),
  quantity: z.number().positive('quantity must be greater than zero'),
});

export type HaveItArgs = z.infer<typeof haveItArgsSchema>;
