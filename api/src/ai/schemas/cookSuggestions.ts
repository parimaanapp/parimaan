import { z } from 'zod';
import {
  MAX_INGREDIENTS,
  MAX_STEP_LENGTH,
  MAX_STEPS,
  MAX_TITLE_LENGTH,
} from '../../validation/recipeShared.js';
import { geminiIngredientSchema, geminiRecipeDraftSchema } from './recipeDraft.js';

/**
 * Models return servings and times as text ("4", "20 mins") as often as
 * numbers, and the W7 schema rejects text outright, which would lose a good
 * suggestion over a cook time. A whole number, or a string that is only a
 * whole number with an optional "min"/"minutes" unit, is accepted; anything
 * else ("1 hour 30", "2-3", "about half an hour", 4.5) becomes null. A wrong
 * time on screen is worse than none, so nothing is guessed from a leading
 * digit, and out-of-range values are dropped rather than clamped.
 */
const WHOLE_NUMBER_TEXT = /^\s*(\d{1,4})\s*(?:mins?|minutes?)?\s*$/i;

const lenientCount = (min: number, max: number) =>
  z.preprocess((value) => {
    const candidate = typeof value === 'string' ? Number(WHOLE_NUMBER_TEXT.exec(value)?.[1] ?? Number.NaN) : value;
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= min && candidate <= max ? candidate : null;
  }, z.number().int().nullable());

const MAX_SERVINGS = 100;
const MAX_MINUTES = 24 * 60;

/**
 * W21 S1 (`E2E_MVP_PLAN.md` §28 D1/D10) — the structural shape
 * `invokeModel` validates a `cookFromPantry` response against.
 *
 * Reuses `geminiRecipeDraftSchema` so `toRecipeDraft` maps a suggestion with
 * no changes — a suggestion IS a recipe draft. It is stricter than that
 * schema on exactly the fields a suggestion cannot be useful without: a
 * title, at least one ingredient and at least one step (the parse schema
 * lets them be null/empty, because "no recipe found" is an honest answer to
 * a parse; for a suggestion it is a failure). Bounds are `createRecipe`'s own
 * caps, so a suggestion the user cannot save is never proposed (§13.2.5).
 *
 * Enum leniency is unchanged from W7 D4: an unknown role, cuisine or dietary
 * tag degrades one field with a warning in `toRecipeDraft`, never fails the
 * parse.
 */
export const geminiCookSuggestionSchema = geminiRecipeDraftSchema.extend({
  servings: lenientCount(1, MAX_SERVINGS),
  prepMin: lenientCount(0, MAX_MINUTES),
  cookMin: lenientCount(0, MAX_MINUTES),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  ingredients: z.array(geminiIngredientSchema).min(1).max(MAX_INGREDIENTS),
  steps: z.array(z.string().trim().min(1).max(MAX_STEP_LENGTH)).min(1).max(MAX_STEPS),
});

/**
 * The product asks for 3. The schema tolerates up to this many so a model
 * that offers a fourth is truncated by the resolver (keeping the best three
 * after grounding and filtering) rather than earning a reinforcement retry;
 * anything beyond it is a runaway response and is rejected.
 */
export const MAX_RAW_COOK_SUGGESTIONS = 5;

export const geminiCookSuggestionsSchema = z.object({
  suggestions: z.array(geminiCookSuggestionSchema).max(MAX_RAW_COOK_SUGGESTIONS),
});

export type GeminiCookSuggestions = z.infer<typeof geminiCookSuggestionsSchema>;
