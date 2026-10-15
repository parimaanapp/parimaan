import { MAX_INGREDIENT_NOTES_LENGTH } from '../../validation/recipeShared.js';
import { isAlwaysStaple } from './normaliseIngredient.js';
import type { NormalisedIngredient } from './normaliseIngredient.js';

/** 1 cup = 240 ml (the metric cup used by Indian recipe sites); only applied when the other row is already ml/l. */
const ML_PER_CUP = 240;

interface Dimension {
  readonly family: 'mass' | 'volume' | 'spoon';
  readonly factor: number;
}

/** Factors relative to the family's smallest unit: g, ml, tsp (1 tbsp = 3 tsp). */
const DIMENSIONS: Readonly<Record<string, Dimension>> = {
  g: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  ml: { family: 'volume', factor: 1 },
  l: { family: 'volume', factor: 1000 },
  tsp: { family: 'spoon', factor: 1 },
  tbsp: { family: 'spoon', factor: 3 },
};

const dimensionOf = (unit: string | null): Dimension | null => (unit !== null && Object.hasOwn(DIMENSIONS, unit) ? (DIMENSIONS[unit] ?? null) : null);

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

interface Amount {
  readonly quantity: number | null;
  readonly unit: string | null;
}

type QuantifiedAmount = Amount & { quantity: number };

/** cup + ml/l: the sum is expressed in the ml/l row's own unit; null when `volume` is not ml/l or `cup` is not a cup. */
const sumCupWithVolume = (cup: QuantifiedAmount, volume: QuantifiedAmount): Amount | null => {
  const volumeDim = dimensionOf(volume.unit);
  if (cup.unit !== 'cup' || volumeDim === null || volumeDim.family !== 'volume') {
    return null;
  }
  return { quantity: round((cup.quantity * ML_PER_CUP) / volumeDim.factor + volume.quantity), unit: volume.unit };
};

const sumConvertible = (a: QuantifiedAmount, b: QuantifiedAmount): Amount | null => {
  if (a.unit === b.unit) {
    return { quantity: round(a.quantity + b.quantity), unit: a.unit };
  }
  const dimA = dimensionOf(a.unit);
  const dimB = dimensionOf(b.unit);
  if (dimA !== null && dimB !== null && dimA.family === dimB.family) {
    return { quantity: round(a.quantity + (b.quantity * dimB.factor) / dimA.factor), unit: a.unit };
  }
  return sumCupWithVolume(a, b) ?? sumCupWithVolume(b, a);
};

/** Combines two amounts, or returns null when the units are not safely addable. A quantity-less side defers to the other. */
const combineAmounts = (a: Amount, b: Amount): Amount | null => {
  if (a.quantity === null && b.quantity === null) {
    return { quantity: null, unit: a.unit ?? b.unit };
  }
  if (a.quantity === null) {
    return b;
  }
  if (b.quantity === null) {
    return a;
  }
  return sumConvertible({ ...a, quantity: a.quantity }, { ...b, quantity: b.quantity });
};

/** Names longer than this are truncated before keying: bounds work on hostile input and no real ingredient name is longer. */
const MAX_KEY_SOURCE_LENGTH = 200;

const PREP_ADVERB = '(?:(?:finely|roughly|coarsely|thinly|freshly|lightly|very|well)\\s+)*';
const PREP_WORD =
  '(?:chopped|sliced|diced|minced|grated|crushed|optional|fresh|pur[eé]ed|ground|peeled|washed|soaked|cubed|shredded|mashed|beaten|melted|softened|deseeded|trimmed|cleaned|rinsed|drained|boiled|roasted|toasted)';
const PREP_PART = new RegExp(`^(?:${PREP_ADVERB}${PREP_WORD}(?:\\s.*)?|(?:about|approx\\.?|approximately|around)\\s.*)$`);

/** True when every comma/and/or-separated part is a pure preparation note, which never distinguishes one ingredient from another. */
const isPrepNote = (inner: string): boolean =>
  inner
    .toLowerCase()
    .split(/\s*(?:,|;|\band\b|\bor\b)\s*/)
    .every((part) => part !== '' && PREP_PART.test(part.trim()));

/**
 * Case/whitespace/punctuation-insensitive key. Parentheticals that are pure
 * prep notes are ignored; any other ("whole", "green") stays in the key so
 * "Dal (whole)" and "Dal (split)" never merge. Input is capped and the
 * parenthetical pattern excludes "(" so keying is linear-time.
 */
export const ingredientMergeKey = (name: string): string => {
  const capped = name.slice(0, MAX_KEY_SOURCE_LENGTH).normalize('NFC').toLowerCase();
  const key = capped
    .replace(/\(([^()]*)\)/g, (_match, inner: string) => (isPrepNote(inner) ? ' ' : ` ${inner} `))
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
  // Names with no letters/digits at all (emoji, "???") must never collapse into one shared empty key.
  return key === '' ? capped.trim() : key;
};

const joinDistinct = (parts: readonly (string | null)[], separator: string): string | null => {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    if (part === null || part === '') {
      continue;
    }
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(part);
    }
  }
  return kept.length === 0 ? null : kept.join(separator);
};

const MAX_MERGED_RAW_LENGTH = 1000;

const mergePair = (base: NormalisedIngredient, other: NormalisedIngredient, amount: Amount): NormalisedIngredient => ({
  raw: (joinDistinct([base.raw, other.raw], ' + ') ?? base.raw).slice(0, MAX_MERGED_RAW_LENGTH),
  name: base.name,
  quantity: amount.quantity,
  unit: amount.unit,
  notes: joinDistinct([base.notes, other.notes], ', ')?.slice(0, MAX_INGREDIENT_NOTES_LENGTH) ?? null,
  // Salt/pepper are always staples. Otherwise a staple flag survives a merge only when no measured quantity resulted, or every source row was staple.
  isStaple: isAlwaysStaple(base.name) || (amount.quantity === null ? base.isStaple || other.isStaple : base.isStaple && other.isStaple),
});

/**
 * Collapses rows that name the same ingredient into one, summing quantities
 * when the units are identical or convertible (g/kg, ml/l, tsp/tbsp, and
 * cup with ml/l). Rows with unit-incompatible quantities stay separate
 * rather than guessing. Keeps the first occurrence's position and name.
 * Pure: never mutates its input.
 */
export const mergeDuplicateIngredients = (rows: readonly NormalisedIngredient[]): NormalisedIngredient[] => {
  const merged: NormalisedIngredient[] = [];
  const keys: string[] = [];
  const indexesByKey = new Map<string, number[]>();
  for (const row of rows) {
    const key = ingredientMergeKey(row.name);
    const candidates = indexesByKey.get(key) ?? [];
    let combined = false;
    for (const index of candidates) {
      const amount = combineAmounts(merged[index]!, row);
      if (amount !== null) {
        merged[index] = mergePair(merged[index]!, row, amount);
        combined = true;
        break;
      }
    }
    if (!combined) {
      keys.push(key);
      indexesByKey.set(key, [...candidates, merged.length]);
      merged.push(row);
    }
  }
  return merged;
};
