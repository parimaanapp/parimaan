import { z } from 'zod';
import { RECIPE_ROLE_VALUES } from '../domain/recipeRoles.js';
import { CUISINE_TIER1_VALUES } from '../domain/cuisineTiers.js';
import { DIETARY_TAG_VALUES } from '../domain/dietaryTags.js';
import {
  MAX_CUISINE_TIER2_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_INGREDIENTS,
  MAX_STEP_LENGTH,
  MAX_STEPS,
  MAX_TITLE_LENGTH,
  normalizeThenEnum,
  recipeIngredientInputSchema,
} from './recipeShared.js';

/**
 * A partial patch — every field `.optional()`, deliberately NOT
 * `.nullable()`, exactly matching `pantryItemPatchSchema`'s own doc: an
 * absent field means "leave unchanged"; an explicit `null` is rejected
 * (clearing a field is not yet supported). The `.refine` below rejects a
 * patch with every field absent.
 *
 * `ingredients`/`steps` carry a third semantic this schema hasn't used
 * before (E2E_MVP_PLAN.md §12.2.4): optional, but when PRESENT they
 * REPLACE the whole list rather than patching individual entries — a list
 * can't express "change ingredient 3" any other way. An explicit empty
 * list (`ingredients: []`) is a valid, present value (not `undefined`) and
 * clears every ingredient; an absent `ingredients` key leaves the existing
 * list untouched. The resolver distinguishes these by checking
 * `input.ingredients !== undefined` on the parsed result directly, not by
 * any stripping step — this schema only needs to make both shapes parse
 * successfully, which `.optional()` (not `.nullish()`) already does: an
 * absent key parses to `undefined`, a present `[]` parses to `[]`.
 */
export const recipePatchInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'title must not be empty')
      .max(MAX_TITLE_LENGTH, `title must be at most ${MAX_TITLE_LENGTH} characters`)
      .optional(),
    description: z
      .string()
      .trim()
      .max(MAX_DESCRIPTION_LENGTH, `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
      .optional(),
    servings: z.number().int().min(1, 'servings must be at least 1').optional(),
    prepMin: z.number().int().min(0, 'prepMin must not be negative').optional(),
    cookMin: z.number().int().min(0, 'cookMin must not be negative').optional(),
    cuisineTier1: normalizeThenEnum(CUISINE_TIER1_VALUES).optional(),
    cuisineTier2: z
      .string()
      .trim()
      .max(MAX_CUISINE_TIER2_LENGTH, `cuisineTier2 must be at most ${MAX_CUISINE_TIER2_LENGTH} characters`)
      .optional(),
    dietaryTags: z.array(normalizeThenEnum(DIETARY_TAG_VALUES)).optional(),
    role: normalizeThenEnum(RECIPE_ROLE_VALUES).optional(),
    inRotation: z.boolean().optional(),
    ingredients: z
      .array(recipeIngredientInputSchema)
      .max(MAX_INGREDIENTS, `ingredients must contain at most ${MAX_INGREDIENTS} items`)
      .optional(),
    steps: z
      .array(z.string().trim().max(MAX_STEP_LENGTH, `each step must be at most ${MAX_STEP_LENGTH} characters`))
      .max(MAX_STEPS, `steps must contain at most ${MAX_STEPS} items`)
      .optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Input must contain at least one field to update.',
  });

export type RecipePatchInput = z.infer<typeof recipePatchInputSchema>;

export const updateRecipeArgsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  input: recipePatchInputSchema,
});

export type UpdateRecipeArgs = z.infer<typeof updateRecipeArgsSchema>;

/** Validates `Mutation.deleteRecipe`'s `{ id: ID! }` argument — same shape as `deletePantryItemArgsSchema`. */
export const deleteRecipeArgsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export type DeleteRecipeArgs = z.infer<typeof deleteRecipeArgsSchema>;
