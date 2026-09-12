import { z } from 'zod';

/**
 * `Mutation.exportShoppingListImage`'s arguments (W17 S6, E2E_MVP_PLAN.md
 * §23.2.8 D8). Deliberately just `listId` — the resolver re-derives the
 * household from the list itself, the same `itemId`-only shape
 * `markPurchased`/`haveIt` already use for a household-scoped argument.
 */
export const exportShoppingListImageArgsSchema = z.object({
  listId: z.string().uuid('listId must be a valid UUID'),
});

export type ExportShoppingListImageArgs = z.infer<typeof exportShoppingListImageArgsSchema>;
