import { z } from 'zod';
import { householdIdSchema } from './householdId.js';
import { RECIPE_ROLE_VALUES } from '../domain/recipeRoles.js';
import { CUISINE_TIER1_VALUES } from '../domain/cuisineTiers.js';
import { DIETARY_TAG_VALUES } from '../domain/dietaryTags.js';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CUISINE_TIER2_LENGTH = 60;
const MAX_INGREDIENT_NAME_LENGTH = 120;
const MAX_INGREDIENT_UNIT_LENGTH = 20;
const MAX_INGREDIENT_CATEGORY_LENGTH = 40;
const MAX_INGREDIENT_NOTES_LENGTH = 500;
const MAX_STEP_LENGTH = 2000;

/**
 * Bounds `RecipeInput.ingredients`/`.steps` — unbounded lists reaching the
 * resolver's per-item insert loop are a straightforward resource-
 * exhaustion vector, the same reasoning as `bulkAddPantryItems.ts`'s
 * `MAX_BULK_PANTRY_ITEMS` (E2E_MVP_PLAN.md §12.3 S3). Both allow **zero**
 * entries deliberately — a recipe with no ingredients listed, or no steps
 * written yet, is a real, valid state (the RED test in the locked plan
 * asserts this explicitly), not something to reject.
 */
const MAX_INGREDIENTS = 100;
const MAX_STEPS = 100;

/**
 * Normalises a string (trim + lowercase) before a closed-enum check, same
 * helper as `validation/recipes.ts` — duplicated rather than imported
 * because the two live in genuinely different argument shapes (a top-level
 * filter arg here vs. deeply-nested `RecipeInput` fields there) and Zod
 * schemas compose more clearly kept local to their call site; the actual
 * value LISTS are still the single shared source of truth
 * (`domain/{recipeRoles,cuisineTiers,dietaryTags}.ts`).
 */
const normalizeThenEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(values),
  );

const recipeIngredientInputSchema = z.object({
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
