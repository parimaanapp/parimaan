import { z } from 'zod';

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_CUISINE_TIER2_LENGTH = 60;
export const MAX_INGREDIENT_NAME_LENGTH = 120;
export const MAX_INGREDIENT_UNIT_LENGTH = 20;
export const MAX_INGREDIENT_CATEGORY_LENGTH = 40;
export const MAX_INGREDIENT_NOTES_LENGTH = 500;
export const MAX_STEP_LENGTH = 2000;
/** Same bound `validation/importRecipeFromUrl.ts` uses for its own `url` argument — `RecipeSourceAttribution.sourceUrl` (W7 S6) is stored, untrusted, third-party-influenced text displayed to other household members later, not merely echoed back once. */
export const MAX_SOURCE_URL_LENGTH = 2048;

/**
 * Bounds `ingredients`/`steps` on both `RecipeInput` (create) and
 * `RecipePatchInput` (update) — unbounded lists reaching the resolver's
 * per-item insert loop are a straightforward resource-exhaustion vector,
 * the same reasoning as `bulkAddPantryItems.ts`'s `MAX_BULK_PANTRY_ITEMS`
 * (E2E_MVP_PLAN.md §12.3 S3). Both allow **zero** entries deliberately — a
 * recipe with no ingredients listed, or no steps written yet, is a real,
 * valid state, not something to reject.
 */
export const MAX_INGREDIENTS = 100;
export const MAX_STEPS = 100;

/**
 * Normalises a string (trim + lowercase) before a closed-enum check.
 * Shared between `createRecipe.ts` and `updateRecipe.ts` rather than each
 * keeping its own copy — the exact class of drift that produced the S1
 * `cuisine_tier1` CHECK bug (`1787811731724_fix-recipes-cuisine-tier1-check.ts`)
 * is precisely two call sites quietly disagreeing about a shared rule.
 */
export const normalizeThenEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(values),
  );

/**
 * Shape of one `RecipeIngredientInput`/`RecipeIngredientInput` entry —
 * identical on create and update (a patch's `ingredients` replaces the
 * whole list rather than patching individual entries, §12.2.4, so each
 * entry is a full ingredient, never itself a partial patch).
 */
export const recipeIngredientInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'ingredient name must not be empty')
    .max(MAX_INGREDIENT_NAME_LENGTH, `ingredient name must be at most ${MAX_INGREDIENT_NAME_LENGTH} characters`),
  quantity: z.number().min(0, 'ingredient quantity must not be negative').nullish(),
  unit: z.string().trim().max(MAX_INGREDIENT_UNIT_LENGTH, `ingredient unit must be at most ${MAX_INGREDIENT_UNIT_LENGTH} characters`).nullish(),
  category: z
    .string()
    .trim()
    .max(MAX_INGREDIENT_CATEGORY_LENGTH, `ingredient category must be at most ${MAX_INGREDIENT_CATEGORY_LENGTH} characters`)
    .nullish(),
  notes: z.string().trim().max(MAX_INGREDIENT_NOTES_LENGTH, `ingredient notes must be at most ${MAX_INGREDIENT_NOTES_LENGTH} characters`).nullish(),
  isStaple: z.boolean().nullish(),
});

export type RecipeIngredientInput = z.infer<typeof recipeIngredientInputSchema>;
