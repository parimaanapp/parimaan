import { z } from 'zod';
import { householdIdSchema } from './householdId.js';
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
 * Validates `RecipeInput` for `Mutation.createRecipe`. `.nullish()` on
 * every optional field — same reasoning as `pantryItemInputSchema`'s own
 * comment: a create input, not a patch, so "absent" and "explicit null"
 * mean the identical thing, and a real Ferry client sends the latter for
 * every field the user never touched (the W5 §11.5.5 regression).
 *
 * `role` is the one REQUIRED field with no default — the "role assignment
 * required" DoD gate's actual enforcement point (E2E_MVP_PLAN.md §12.7
 * D1/D2). `cuisineTier1`/`dietaryTags`/`role` all reject unknown values
 * rather than passing them through (§12.2.6, D4) — closed GraphQL enums,
 * unlike `PantryItemInput`'s free-text `unit`/`category`.
 */
export const recipeInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'title must not be empty')
    .max(MAX_TITLE_LENGTH, `title must be at most ${MAX_TITLE_LENGTH} characters`),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH, `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`).nullish(),
  servings: z.number().int().min(1, 'servings must be at least 1').nullish(),
  prepMin: z.number().int().min(0, 'prepMin must not be negative').nullish(),
  cookMin: z.number().int().min(0, 'cookMin must not be negative').nullish(),
  cuisineTier1: normalizeThenEnum(CUISINE_TIER1_VALUES).nullish(),
  cuisineTier2: z.string().trim().max(MAX_CUISINE_TIER2_LENGTH, `cuisineTier2 must be at most ${MAX_CUISINE_TIER2_LENGTH} characters`).nullish(),
  dietaryTags: z.array(normalizeThenEnum(DIETARY_TAG_VALUES)).nullish(),
  role: normalizeThenEnum(RECIPE_ROLE_VALUES),
  inRotation: z.boolean().nullish(),
  ingredients: z.array(recipeIngredientInputSchema).max(MAX_INGREDIENTS, `ingredients must contain at most ${MAX_INGREDIENTS} items`),
  steps: z
    .array(z.string().trim().max(MAX_STEP_LENGTH, `each step must be at most ${MAX_STEP_LENGTH} characters`))
    .max(MAX_STEPS, `steps must contain at most ${MAX_STEPS} items`),
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

export const createRecipeArgsSchema = z.object({
  householdId: householdIdSchema,
  input: recipeInputSchema,
});

export type CreateRecipeArgs = z.infer<typeof createRecipeArgsSchema>;
