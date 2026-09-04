import { z } from 'zod';

/**
 * `Mutation.markPurchased`'s arguments (W12 S3, E2E_MVP_PLAN.md §18.3 S3;
 * D5, §18.2.5). Deliberately just `itemId` — D5 locks NO `quantity`
 * argument for this mutation (unlike `haveItArgsSchema`'s own `quantity`),
 * so there is nothing else to validate here.
 */
export const markPurchasedArgsSchema = z.object({
  itemId: z.string().uuid('itemId must be a valid UUID'),
});

export type MarkPurchasedArgs = z.infer<typeof markPurchasedArgsSchema>;
