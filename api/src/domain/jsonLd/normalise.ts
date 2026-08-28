import { parseIngredientString } from '../ingredientString.js';
import type { ParsedIngredient } from '../ingredientString.js';
import { MAX_INGREDIENTS } from '../../validation/recipeShared.js';
import { extractJsonLdBlocks } from './extract.js';
import { selectRecipeNode } from './selectRecipeNode.js';
import { parseIsoDurationToMinutes } from './duration.js';
import { parseRecipeYield } from './yield.js';
import { flattenInstructions } from './instructions.js';

/** The subset of `RecipeDraft`'s shape (S3, §13.2.3) a JSON-LD page can actually populate — no `role`/`cuisineTier1`/`dietaryTags`/`sourceUrl`: neither JSON-LD nor this module has anything honest to say about those, and `sourceUrl` is `importRecipeFromUrl`'s (S5) job to attach, not this pure module's. */
export interface JsonLdRecipeDraft {
  title: string;
  description: string | null;
  servings: number | null;
  prepMin: number | null;
  cookMin: number | null;
  ingredients: ParsedIngredient[];
  steps: string[];
  warnings: string[];
}

/** A handful of stock phrases real recipe sites use as placeholder/redirect text in place of actual content (S1's `nishamadhulika` fixture, verbatim: `"Available in post please open the link"`, §13.5.12) — not exhaustive, just the concretely observed cases. */
const PLACEHOLDER_TEXT_PATTERNS: readonly RegExp[] = [/available in (the )?post/i, /open the link/i, /see (the )?(post|link|above)/i];

const looksLikePlaceholder = (text: string): boolean => PLACEHOLDER_TEXT_PATTERNS.some((pattern) => pattern.test(text));

/**
 * A structurally-valid draft (passes the "usable" gate below) whose actual
 * content is a placeholder/redirect sentence rather than a real recipe —
 * `nishamadhulika`'s own fixture counts toward S1's 14/20 by the letter of
 * D10's rule, but must not silently render as a clean draft in S7's
 * "proposed" UI (§13.5.12's own named finding). Only checked when there is
 * exactly one ingredient or one step, since a placeholder sentence standing
 * in for an entire list is the actual failure shape observed — a real
 * multi-ingredient recipe that happens to mention "see the post" in one
 * step's text is not this case.
 */
const detectPlaceholderWarning = (ingredients: ParsedIngredient[], steps: string[]): string | null => {
  const singleIngredientPlaceholder = ingredients.length === 1 && looksLikePlaceholder(ingredients[0]!.raw);
  const singleStepPlaceholder = steps.length === 1 && looksLikePlaceholder(steps[0]!);
  return singleIngredientPlaceholder || singleStepPlaceholder
    ? "This recipe's ingredients or steps could not be reliably read from the source page and may be placeholder text — check them carefully before saving."
    : null;
};

/**
 * `parseIngredientString` only knows how to parse strings — an array entry
 * that is itself a number or object (malformed third-party JSON-LD; not a
 * shape any of S1's 20 real fixtures produced) is out of scope for this
 * module and is dropped here, the identical scope limit `duration.ts`/
 * `yield.ts` each document for the input shapes they don't attempt to
 * handle, rather than an accidental gap.
 */
const toIngredientList = (value: unknown): ParsedIngredient[] => {
  const rawStrings = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  return rawStrings
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .slice(0, MAX_INGREDIENTS)
    .map(parseIngredientString);
};

/**
 * The full pipeline: raw page HTML → extracted JSON-LD blocks → the
 * selected `Recipe` node → a `RecipeDraft`-shaped result, or `null` when no
 * `Recipe` node is present, or one is present but not usable. "Usable"
 * mirrors D10's own definition exactly (§13.2.11/§13.5.12): a title, at
 * least one ingredient, and at least one step. `bongeats`'s fixture — a
 * well-formed `Recipe` node with both `recipeIngredient`/
 * `recipeInstructions` as empty arrays — fails this gate naturally, with no
 * special-casing needed: it is the one S1 site (of 15 present) excluded
 * from the 14/20 usable count.
 *
 * Never throws: a page with no JSON-LD, or JSON-LD with no `Recipe` node,
 * both return `null`, the same outcome a caller (S5's `importRecipeFromUrl`)
 * maps to its own "couldn't read this page" copy.
 */
export const parseJsonLdRecipe = (html: string): JsonLdRecipeDraft | null => {
  const recipeNode = selectRecipeNode(extractJsonLdBlocks(html));
  if (recipeNode === null) {
    return null;
  }

  const title = typeof recipeNode['name'] === 'string' ? recipeNode['name'].trim() : '';
  const ingredients = toIngredientList(recipeNode['recipeIngredient']);
  const steps = flattenInstructions(recipeNode['recipeInstructions']);

  if (title === '' || ingredients.length === 0 || steps.length === 0) {
    return null;
  }

  const description = typeof recipeNode['description'] === 'string' ? recipeNode['description'].trim() || null : null;
  const warning = detectPlaceholderWarning(ingredients, steps);

  return {
    title,
    description,
    servings: parseRecipeYield(recipeNode['recipeYield']),
    prepMin: parseIsoDurationToMinutes(recipeNode['prepTime']),
    cookMin: parseIsoDurationToMinutes(recipeNode['cookTime']),
    ingredients,
    steps,
    warnings: warning === null ? [] : [warning],
  };
};
