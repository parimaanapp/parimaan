import { z } from 'zod';
import { recipeInputSchema } from './createRecipe.js';
import { recipeIngredientInputSchema } from './recipeShared.js';

/**
 * The curated-content-specific strictness layered on top of `RecipeInput`
 * (W15 §21.2.2 D2) — a checked-in curated recipe must have at least one
 * ingredient and one non-empty step, unlike a live-authored `RecipeInput`
 * (`recipeShared.ts`'s own comment: a recipe with no ingredients/steps yet
 * is a valid in-progress state for a user actively drafting one).
 *
 * This schema lives in `src/validation/` (not `scripts/`) so BOTH
 * `api/scripts/validateCuratedRecipes.ts` (the check-in-time validator) and
 * `api/src/curatedRecipes.ts` (the runtime seeder reader, W16 S5) import
 * the identical schema from one place, rather than either re-declaring it.
 * `scripts/` is allowed to import from `src/` (see `api/tsconfig.json`'s
 * own comment on this), but `src/` must never import from `scripts/` — a
 * `scripts/`-only module has no business in the Lambda's runtime
 * dependency graph — so the schema had to live here, in `src/`, to be
 * reusable by both without inverting that boundary.
 */
export const curatedRecipeInputSchema = recipeInputSchema.extend({
  ingredients: z
    .array(recipeIngredientInputSchema)
    .min(1, 'ingredients must contain at least one item'),
  steps: z
    .array(z.string().trim().min(1, 'each step must not be empty'))
    .min(1, 'steps must contain at least one item'),
});

export type CuratedRecipeInputSchema = z.infer<typeof curatedRecipeInputSchema>;
