import { z } from 'zod';
import { coerceQuantityText } from '../../domain/ingredientString.js';
import { CUISINE_TIER1_VALUES } from '../../domain/cuisineTiers.js';
import type { CuisineTier1 } from '../../domain/cuisineTiers.js';
import { DIETARY_TAG_VALUES } from '../../domain/dietaryTags.js';
import type { DietaryTag } from '../../domain/dietaryTags.js';
import { RECIPE_ROLE_VALUES } from '../../domain/recipeRoles.js';
import type { RecipeRole } from '../../domain/recipeRoles.js';
import {
  MAX_CUISINE_TIER2_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_INGREDIENT_NOTES_LENGTH,
  MAX_INGREDIENT_UNIT_LENGTH,
  MAX_INGREDIENTS,
  MAX_STEP_LENGTH,
  MAX_STEPS,
  MAX_TITLE_LENGTH,
} from '../../validation/recipeShared.js';

/**
 * Generous but bounded — this is a defensive cap against a runaway model
 * response, not a real content limit; `MAX_INGREDIENT_UNIT_LENGTH`-style
 * precision doesn't matter here since a too-long quantity string is
 * rejected outright, not silently truncated. `coerceQuantityText` below
 * decides whether it's a clean number or vague leftover text.
 */
const MAX_QUANTITY_TEXT_LENGTH = 200;

/**
 * The **structural** shape `invokeModel` validates the model's JSON
 * response against (§13.2.5 D4: "reject the whole thing" only for
 * structure/bounds, never for an enum value). Deliberately does NOT
 * restrict `cuisineTier1`/`role`/`dietaryTags` to their closed enum
 * values, and deliberately does NOT convert `quantity` to a number — both
 * are `toRecipeDraft`'s job below, a separate post-parse step, precisely
 * so an unrecognised enum value or a vague quantity phrase degrades one
 * field with a warning instead of failing `invokeModel`'s
 * `schema.safeParse` and burning a reinforcement retry on content the
 * model already answered honestly (§13.2.2's own finding on `quantity`).
 * Bounds (`MAX_INGREDIENTS`/`MAX_STEPS`/`MAX_STEP_LENGTH`, §12.3 S3) are
 * reused exactly from `createRecipe`'s own caps — a draft that could not
 * be saved must never be proposed (§13.2.5).
 */
const geminiIngredientSchema = z.object({
  name: z.string().trim().min(1).max(MAX_INGREDIENT_NAME_LENGTH),
  quantity: z.string().trim().max(MAX_QUANTITY_TEXT_LENGTH).nullish(),
  unit: z.string().trim().max(MAX_INGREDIENT_UNIT_LENGTH).nullish(),
  notes: z.string().trim().max(MAX_INGREDIENT_NOTES_LENGTH).nullish(),
});

export const geminiRecipeDraftSchema = z.object({
  title: z.string().trim().max(MAX_TITLE_LENGTH).nullish(),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullish(),
  servings: z.number().int().min(1).nullish(),
  prepMin: z.number().int().min(0).nullish(),
  cookMin: z.number().int().min(0).nullish(),
  cuisineTier1: z.string().trim().max(60).nullish(),
  cuisineTier2: z.string().trim().max(MAX_CUISINE_TIER2_LENGTH).nullish(),
  dietaryTags: z.array(z.string().trim().max(40)).max(20).nullish(),
  role: z.string().trim().max(60).nullish(),
  ingredients: z.array(geminiIngredientSchema).max(MAX_INGREDIENTS),
  steps: z.array(z.string().trim().max(MAX_STEP_LENGTH)).max(MAX_STEPS),
});

export type GeminiRecipeDraft = z.infer<typeof geminiRecipeDraftSchema>;

export interface RecipeDraftIngredientResult {
  raw: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

/**
 * The canonical `RecipeDraft` SDL shape (§13.2.3), shared by both parse
 * mutations — `parseFreeformRecipe` (this module) always sets `sourceUrl`
 * to `null` (a Gemini parse has no source page), while `importRecipeFromUrl`
 * (S5, `resolvers/importRecipeFromUrl.ts`) sets it to the confirmed,
 * already-validated URL. One shared type rather than two near-identical
 * ones, since a later slice (S10's shared draft-review screen) treats
 * both mutations' results identically.
 */
export interface RecipeDraftResult {
  title: string | null;
  description: string | null;
  servings: number | null;
  prepMin: number | null;
  cookMin: number | null;
  cuisineTier1: CuisineTier1 | null;
  cuisineTier2: string | null;
  dietaryTags: DietaryTag[];
  role: RecipeRole | null;
  ingredients: RecipeDraftIngredientResult[];
  steps: string[];
  sourceUrl: string | null;
  warnings: string[];
}

interface EnumNormalizationResult<T> {
  readonly value: T | null;
  readonly warning: string | null;
}

/**
 * Normalises one free-text enum candidate against `values` (trim +
 * lowercase, matching `validation/recipeShared.ts`'s `normalizeThenEnum`
 * convention on the write side) — `null`/absent passes through as `null`
 * with no warning (omission is not itself a failure, §13.2.6), an
 * unrecognised non-null value degrades to `null` WITH a warning (§13.2.5
 * D4). Returns `{value, warning}` rather than mutating a shared array
 * (this codebase's immutable-update convention) — `toRecipeDraft` below
 * composes the result into its own new `warnings` array.
 */
const normalizeEnumWithWarning = <T extends readonly string[]>(
  value: string | null | undefined,
  values: T,
  fieldLabel: string,
): EnumNormalizationResult<T[number]> => {
  if (value === null || value === undefined) {
    return { value: null, warning: null };
  }
  const normalized = value.trim().toLowerCase();
  const match = values.find((candidate) => candidate === normalized);
  return match === undefined
    ? { value: null, warning: `The AI suggested a ${fieldLabel} of "${value}", which isn't one Parimaan recognises — left unset.` }
    : { value: match, warning: null };
};

/** Reconstructs a `raw` ingredient line from the model's already-separated fields — there is no single source string to preserve verbatim the way JSON-LD's `recipeIngredient` string has one, so this is the closest honest equivalent. */
const buildRawIngredientLine = (ingredient: GeminiRecipeDraft['ingredients'][number]): string =>
  [ingredient.quantity, ingredient.unit, ingredient.name].filter((part): part is string => Boolean(part)).join(' ');

/**
 * Maps one model-returned ingredient to `RecipeDraftIngredientResult`,
 * coercing `quantity` via `ingredientString.ts`'s shared
 * `coerceQuantityText` (§13.2.2's own finding: Gemini returns `quantity`
 * as a string even for clean numeric amounts). A vague amount ("a
 * fistful") is never silently dropped — it's folded into the ingredient's
 * own `name` so the information survives even though it can't become a
 * `Float`. The fold is truncated to `MAX_INGREDIENT_NAME_LENGTH` —
 * `ingredient.name` alone is already within that bound (the schema's own
 * job), but appending a up-to-200-char `leftoverText` phrase could push
 * the combined string past what `createRecipe`'s own
 * `recipeIngredientInputSchema` accepts (flagged by `security-reviewer`):
 * a draft the review screen shows as clean must not fail validation the
 * moment the user confirms it unmodified.
 */
const toIngredientDraft = (ingredient: GeminiRecipeDraft['ingredients'][number]): RecipeDraftIngredientResult => {
  const { quantity, leftoverText } = coerceQuantityText(ingredient.quantity ?? '');
  const name = leftoverText === null ? ingredient.name : `${ingredient.name} (${leftoverText})`.slice(0, MAX_INGREDIENT_NAME_LENGTH);
  return {
    raw: buildRawIngredientLine(ingredient) || ingredient.name,
    name,
    quantity,
    unit: ingredient.unit ?? null,
    notes: ingredient.notes ?? null,
  };
};

/**
 * The post-parse step implementing D4's enum leniency and D11/§13.2.2's
 * quantity coercion — deliberately separate from `geminiRecipeDraftSchema`
 * itself (`invokeModel`'s own doc comment: it only ever sees "parsed
 * successfully" or "didn't", enum leniency is entirely the caller's job).
 * Never throws and never fails a draft: every field here has an honest
 * fallback (`null`, `[]`, or a warning), because by the time this runs,
 * `invokeModel` has already proven the response is structurally valid.
 */
export const toRecipeDraft = (raw: GeminiRecipeDraft): RecipeDraftResult => {
  const cuisineResult = normalizeEnumWithWarning(raw.cuisineTier1 ?? null, CUISINE_TIER1_VALUES, 'cuisine');
  const roleResult = normalizeEnumWithWarning(raw.role ?? null, RECIPE_ROLE_VALUES, 'meal role');
  const dietaryTagResults = (raw.dietaryTags ?? []).map((tag) => normalizeEnumWithWarning(tag, DIETARY_TAG_VALUES, 'dietary tag'));

  const cuisineTier1 = cuisineResult.value;
  const role = roleResult.value;
  const dietaryTags = dietaryTagResults.map((result) => result.value).filter((tag): tag is DietaryTag => tag !== null);
  const warnings = [cuisineResult, roleResult, ...dietaryTagResults]
    .map((result) => result.warning)
    .filter((warning): warning is string => warning !== null);

  return {
    title: raw.title ?? null,
    description: raw.description ?? null,
    servings: raw.servings ?? null,
    prepMin: raw.prepMin ?? null,
    cookMin: raw.cookMin ?? null,
    cuisineTier1,
    cuisineTier2: raw.cuisineTier2 ?? null,
    dietaryTags,
    role,
    ingredients: raw.ingredients.map(toIngredientDraft),
    steps: raw.steps,
    sourceUrl: null,
    warnings,
  };
};
