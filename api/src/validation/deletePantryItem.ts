import { z } from 'zod';

/** Validates `Mutation.deletePantryItem`'s `{ id: ID! }` argument. */
export const deletePantryItemArgsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export type DeletePantryItemArgs = z.infer<typeof deletePantryItemArgsSchema>;
