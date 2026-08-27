import { z } from 'zod';

/** Validates `Mutation.favoriteRecipe`'s `{ id: ID!, favorite: Boolean! }` arguments. */
export const favoriteRecipeArgsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  favorite: z.boolean(),
});

export type FavoriteRecipeArgs = z.infer<typeof favoriteRecipeArgsSchema>;
