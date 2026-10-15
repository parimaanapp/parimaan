import type { ParsedIngredient } from '../ingredientString.js';
import { mergeDuplicateIngredients } from './mergeIngredients.js';
import { normaliseIngredient } from './normaliseIngredient.js';
import type { NormalisedIngredient } from './normaliseIngredient.js';

export { cleanText, decodeHtmlEntities } from './text.js';
export { canonicaliseUnit } from './units.js';
export { mergeDuplicateIngredients } from './mergeIngredients.js';
export { normaliseIngredient } from './normaliseIngredient.js';
export type { NormalisedIngredient } from './normaliseIngredient.js';

/**
 * The ONE shared ingredient normalisation step for recipe import: the URL
 * (JSON-LD) path and the free-text paste (Gemini) path both end here.
 * Normalises each row, then merges duplicates (summing convertible
 * quantities). Pure.
 */
export const normaliseIngredientList = (rows: readonly ParsedIngredient[]): NormalisedIngredient[] =>
  mergeDuplicateIngredients(rows.map(normaliseIngredient));
