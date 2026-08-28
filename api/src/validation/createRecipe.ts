import { z } from 'zod';
import { householdIdSchema } from './householdId.js';
import { RECIPE_ROLE_VALUES } from '../domain/recipeRoles.js';
import { CUISINE_TIER1_VALUES } from '../domain/cuisineTiers.js';
import { DIETARY_TAG_VALUES } from '../domain/dietaryTags.js';
import {
  MAX_CUISINE_TIER2_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_INGREDIENTS,
  MAX_SOURCE_URL_LENGTH,
  MAX_STEP_LENGTH,
  MAX_STEPS,
  MAX_TITLE_LENGTH,
  normalizeThenEnum,
  recipeIngredientInputSchema,
} from './recipeShared.js';

/**
 * `RecipeSourceAttribution.sourceType` (§13.2.4 D2) — deliberately a
 * NARROWER set than the full `RecipeSource` enum (`user`/`url`/`curated`/
 * `ai`/`freeform_ai`, `domain/recipeRoles.ts`-style single source of
 * truth would be overkill for two values used nowhere else). `curated`
 * (the W13/W14 seeder) and `ai` (a future cook-from-pantry feature) are
 * server-owned values a client must never be able to claim through this
 * argument — the whole reason this test exists (§13.2.4's own RED test),
 * not an oversight if a client-supplied `curated`/`ai` were ever accepted
 * here. `user` is also excluded: sending `source` at all IS the
 * confirm-a-draft path, and `user` is what absent `source` already means
 * — accepting it explicitly here would blur that distinction for no
 * benefit.
 */
const CLIENT_SOURCE_TYPE_VALUES = ['url', 'freeform_ai'] as const;

/** `https`-only — same reasoning as `validation/importRecipeFromUrl.ts`'s own `url` argument, since this value is later displayed to other household members as stored, untrusted, third-party-influenced text (§12.3 S3's own bound reused here via `MAX_SOURCE_URL_LENGTH`). */
const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * `Mutation.createRecipe`'s optional `source` argument (§13.2.4 D2) — the
 * confirm-a-draft path. Absent/explicit-`null` (handled by `.nullish()` on
 * the whole object at the top-level schema below, per §11.5.5) means
 * `sourceType: 'user'` — every pre-W7 caller keeps working unchanged.
 * When present: `sourceUrl` is REQUIRED iff `sourceType: 'url'` and
 * REJECTED for every other `sourceType` — a `freeform_ai` draft has no
 * source page, and allowing a `sourceUrl` alongside it would let a client
 * attach unrelated third-party content to a recipe under false pretenses.
 */
const recipeSourceAttributionSchema = z
  .object({
    sourceType: z.enum(CLIENT_SOURCE_TYPE_VALUES),
    sourceUrl: z
      .string()
      .trim()
      .max(MAX_SOURCE_URL_LENGTH, `sourceUrl must be at most ${MAX_SOURCE_URL_LENGTH} characters`)
      .refine(isHttpsUrl, 'sourceUrl must be a valid https URL')
      .nullish(),
  })
  .superRefine((value, ctx) => {
    const hasSourceUrl = value.sourceUrl !== null && value.sourceUrl !== undefined;
    if (value.sourceType === 'url' && !hasSourceUrl) {
      ctx.addIssue({ code: 'custom', message: 'sourceUrl is required when sourceType is url' });
    }
    if (value.sourceType !== 'url' && hasSourceUrl) {
      ctx.addIssue({ code: 'custom', message: 'sourceUrl must not be set unless sourceType is url' });
    }
  });

export type RecipeSourceAttribution = z.infer<typeof recipeSourceAttributionSchema>;

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
  // `.nullish()` on the whole object, not `.optional()` — a create-time
  // attribution argument follows this codebase's create-input convention
  // (§11.5.5): absent and explicit `null` mean the identical thing,
  // "no attribution, default to user", unlike a patch field.
  source: recipeSourceAttributionSchema.nullish(),
});

export type CreateRecipeArgs = z.infer<typeof createRecipeArgsSchema>;
