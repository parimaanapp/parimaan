import { z } from 'zod';
import { householdIdSchema } from './householdId.js';
import { pantryItemInputSchema } from './addPantryItem.js';

/**
 * Bounds the request itself, not household size — a household can have as
 * many pantry items as it wants over time; this only caps how many one
 * `bulkAddPantryItems` call can attempt, since an unbounded array reaching
 * the resolver's per-item insert loop is a straightforward resource-
 * exhaustion vector (E2E_MVP_PLAN.md §11.3 S3).
 */
export const MAX_BULK_PANTRY_ITEMS = 50;

export const bulkAddPantryItemsArgsSchema = z.object({
  householdId: householdIdSchema,
  items: z
    .array(pantryItemInputSchema)
    .min(1, 'items must contain at least one item')
    .max(MAX_BULK_PANTRY_ITEMS, `items must contain at most ${MAX_BULK_PANTRY_ITEMS} items`),
});

export type BulkAddPantryItemsArgs = z.infer<typeof bulkAddPantryItemsArgsSchema>;
