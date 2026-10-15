import type { ParsedIngredient } from '../ingredientString.js';
import { cleanText } from './text.js';
import { canonicaliseUnit, toCanonicalAmount } from './units.js';

/** Per-field cap applied before any regex runs; real ingredient fields are far shorter. */
const MAX_FIELD_LENGTH = 1000;

/** An ingredient after the shared import normalisation step. */
export interface NormalisedIngredient extends ParsedIngredient {
  /** True only for salt/pepper written "to taste"-style; see `normaliseIngredient`. */
  isStaple: boolean;
}

const TASTE_PHRASE_SOURCE =
  '(?:[,;(-]\\s*|\\s+)?(?:(?:or|and|&)\\s+)?(?:(?:to|as per|per|according to)\\s+(?:your\\s+)?taste|as\\s+(?:needed|required|necessary)|as per\\s+(?:need|requirement))\\)?';
const TASTE_PHRASE = new RegExp(TASTE_PHRASE_SOURCE, 'i');
const TASTE_PHRASE_GLOBAL = new RegExp(TASTE_PHRASE_SOURCE, 'gi');

const SALT_NAME = /^(?:(?:sea|rock|black|table|pink|himalayan|kala|sendha|iodi[sz]ed|kosher|fine|coarse)\s+)*salt$/;
const PEPPER_NAME = /^(?:(?:black|white|ground|crushed|cracked|fresh|freshly ground)\s+)*(?:pepper|peppercorns?)(?:\s+powder)?$/;
const SALT_AND_PEPPER_NAME = /^salt\s*(?:and|&|,)\s*(?:(?:black|white|ground|crushed)\s+)*pepper$/;

/** Exact salt/pepper ingredient names only: not "pepper jack", "bell pepper", "salt-free ...", "salted butter". */
const isSaltOrPepper = (name: string): boolean => {
  const key = name.toLowerCase().replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return SALT_NAME.test(key) || PEPPER_NAME.test(key) || SALT_AND_PEPPER_NAME.test(key);
};

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

/** Canonical spelling for a known unit; an unrecognised non-empty unit is kept lowercased (never replaced by a default); blank is null. */
const normaliseUnit = (cleanedUnit: string): string | null =>
  cleanedUnit === '' ? null : (canonicaliseUnit(cleanedUnit) ?? cleanedUnit.toLowerCase());

/**
 * The per-row half of the shared import normalisation (URL JSON-LD and
 * free-text paste both go through it): entity/whitespace cleanup,
 * canonical units, "to taste" handling and the countable-`piece` default.
 * Never defaults a unit to `cup`. Pure; returns a new object.
 */
export const normaliseIngredient = (input: ParsedIngredient): NormalisedIngredient => {
  const raw = cleanText(input.raw.slice(0, MAX_FIELD_LENGTH));
  const cleanedName = cleanText(input.name.slice(0, MAX_FIELD_LENGTH));
  const cleanedNotes = cleanText((input.notes ?? '').slice(0, MAX_FIELD_LENGTH));
  const cleanedUnit = cleanText((input.unit ?? '').slice(0, MAX_FIELD_LENGTH));

  const toTaste = [cleanedName, cleanedNotes, cleanedUnit].some((text) => TASTE_PHRASE.test(text));
  const hasQuantity = input.quantity !== null;

  if (toTaste && !hasQuantity) {
    const strippedName = stripNameDebris(stripTastePhrase(cleanedName));
    const name = strippedName === '' ? raw : strippedName;
    const notes = stripTastePhrase(cleanedNotes);
    return { raw, name, quantity: null, unit: null, notes: notes === '' ? null : notes, isStaple: isSaltOrPepper(name) };
  }

  if (toTaste) {
    // A parsed quantity is never dropped: the phrase moves out of the name into the notes.
    const phraseInName = TASTE_PHRASE.test(cleanedName) ? (TASTE_PHRASE.exec(cleanedName)?.[0] ?? '') : '';
    const movedPhrase = phraseInName.replace(/^[\s,;(-]+/, '').replace(/^(?:or|and|&)\s+/i, '').replace(/\)$/, '').trim();
    const strippedName = stripNameDebris(stripTastePhrase(cleanedName));
    const name = strippedName === '' ? raw : strippedName;
    const notes = [cleanedNotes, movedPhrase].filter((part) => part !== '').join(', ');
    const unitText = TASTE_PHRASE.test(cleanedUnit) ? '' : cleanedUnit;
    const amount = toCanonicalAmount(input.quantity, normaliseUnit(unitText) ?? 'piece');
    return { raw, name, quantity: amount.quantity, unit: amount.unit, notes: notes === '' ? null : notes, isStaple: false };
  }

  const amount = toCanonicalAmount(input.quantity, normaliseUnit(cleanedUnit) ?? (hasQuantity ? 'piece' : null));
  return { raw, name: stripNameDebris(cleanedName) || raw, quantity: amount.quantity, unit: amount.unit, notes: cleanedNotes === '' ? null : cleanedNotes, isStaple: false };
};
