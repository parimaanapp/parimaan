import type { ParsedIngredient } from '../ingredientString.js';
import { cleanText } from './text.js';
import { canonicaliseUnit } from './units.js';

/** An ingredient after the shared import normalisation step. */
export interface NormalisedIngredient extends ParsedIngredient {
  /** True only for salt/pepper written "to taste"-style; see `normaliseIngredient`. */
  isStaple: boolean;
}

const TASTE_PHRASE_SOURCE =
  '(?:[,;(-]\\s*|\\s+)?(?:(?:or|and|&)\\s+)?(?:(?:to|as per|per|according to)\\s+(?:your\\s+)?taste|as\\s+(?:needed|required|necessary)|as per\\s+(?:need|requirement))\\)?';
const TASTE_PHRASE = new RegExp(TASTE_PHRASE_SOURCE, 'i');
const TASTE_PHRASE_GLOBAL = new RegExp(TASTE_PHRASE_SOURCE, 'gi');

const SALT_WORD = /\bsalt\b/i;
const PEPPER_WORD = /\bpepper\b/i;
const NOT_BLACK_PEPPER = /\b(?:bell|green|red|yellow|orange|chil+i|chil+y|capsicum|jalapeno)\b/i;

const isSaltOrPepper = (name: string): boolean => SALT_WORD.test(name) || (PEPPER_WORD.test(name) && !NOT_BLACK_PEPPER.test(name));

const stripTastePhrase = (text: string): string =>
  text
    .replace(TASTE_PHRASE_GLOBAL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:-]+$/g, '')
    .replace(/\s+(?:or|and)$/i, '')
    .replace(/\(\s*\)/g, '')
    .trim();

const QUOTE_DEBRIS = /^[\s"'“”‘’″′,;:.-]+/;

/** Removes quote/inch-mark debris, and the "piece of" it leaves behind ("\" piece of cinnamon"), plus a bare leading "of". */
const stripNameDebris = (name: string): string => {
  const debris = QUOTE_DEBRIS.exec(name)?.[0] ?? '';
  const hadQuote = /["“”″]/.test(debris);
  const withoutDebris = name.slice(debris.length);
  const withoutPieceOf = hadQuote ? withoutDebris.replace(/^(?:pieces?|pcs?)\s+of\s+/i, '') : withoutDebris;
  return withoutPieceOf.replace(/^of\s+/i, '').trim();
};

const normaliseUnit = (unit: string | null): string | null => {
  if (unit === null) {
    return null;
  }
  const cleaned = cleanText(unit);
  if (cleaned === '') {
    return null;
  }
  return canonicaliseUnit(cleaned) ?? cleaned.toLowerCase();
};

/**
 * The per-row half of the shared import normalisation (URL JSON-LD and
 * free-text paste both go through it): entity/whitespace cleanup,
 * canonical units, "to taste" handling and the countable-`piece` default.
 * Never defaults a unit to `cup`. Pure; returns a new object.
 */
export const normaliseIngredient = (input: ParsedIngredient): NormalisedIngredient => {
  const raw = cleanText(input.raw);
  const cleanedName = cleanText(input.name);
  const cleanedNotes = input.notes === null ? '' : cleanText(input.notes);
  const cleanedUnit = input.unit === null ? '' : cleanText(input.unit);

  const toTaste = [cleanedName, cleanedNotes, cleanedUnit].some((text) => TASTE_PHRASE.test(text));

  const strippedName = stripNameDebris(toTaste ? stripTastePhrase(cleanedName) : cleanedName);
  const name = strippedName === '' ? raw : strippedName;
  const notes = toTaste ? stripTastePhrase(cleanedNotes) : cleanedNotes;

  if (toTaste) {
    return { raw, name, quantity: null, unit: null, notes: notes === '' ? null : notes, isStaple: isSaltOrPepper(name) };
  }

  const quantity = input.quantity;
  const unit = normaliseUnit(input.unit) ?? (quantity !== null ? 'piece' : null);
  return { raw, name, quantity, unit, notes: notes === '' ? null : notes, isStaple: false };
};
