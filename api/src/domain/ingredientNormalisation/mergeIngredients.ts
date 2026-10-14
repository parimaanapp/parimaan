import { MAX_INGREDIENT_NOTES_LENGTH } from '../../validation/recipeShared.js';
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

const sumConvertible = (a: Amount & { quantity: number }, b: Amount & { quantity: number }): Amount | null => {
  if (a.unit === b.unit) {
    return { quantity: round(a.quantity + b.quantity), unit: a.unit };
  }
  const dimA = dimensionOf(a.unit);
  const dimB = dimensionOf(b.unit);
  if (dimA !== null && dimB !== null && dimA.family === dimB.family) {
    return { quantity: round(a.quantity + (b.quantity * dimB.factor) / dimA.factor), unit: a.unit };
  }
  // cup <-> ml/l: the result is expressed in the ml/l row's unit.
  const cupIsA = a.unit === 'cup' && dimB?.family === 'volume';
  const cupIsB = b.unit === 'cup' && dimA?.family === 'volume';
  if (cupIsA && dimB !== null) {
    return { quantity: round((a.quantity * ML_PER_CUP) / dimB.factor + b.quantity), unit: b.unit };
  }
  if (cupIsB && dimA !== null) {
    return { quantity: round(a.quantity + (b.quantity * ML_PER_CUP) / dimA.factor), unit: a.unit };
  }
  return null;
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

/** Case/whitespace/punctuation-insensitive key that ignores parenthetical prep notes. */
export const ingredientMergeKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

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

const mergePair = (base: NormalisedIngredient, other: NormalisedIngredient, amount: Amount): NormalisedIngredient => ({
  raw: joinDistinct([base.raw, other.raw], ' + ') ?? base.raw,
  name: base.name,
  quantity: amount.quantity,
  unit: amount.unit,
  notes: joinDistinct([base.notes, other.notes], ', ')?.slice(0, MAX_INGREDIENT_NOTES_LENGTH) ?? null,
  isStaple: base.isStaple || other.isStaple,
});

/**
 * Collapses rows that name the same ingredient into one, summing quantities
 * when the units are identical or convertible (g/kg, ml/l, tsp/tbsp, and
 * cup with ml/l). Rows with unit-incompatible quantities stay separate
 * rather than guessing. Keeps the first occurrence's position and name.
 * Pure: never mutates its input.
 */
export const mergeDuplicateIngredients = (rows: readonly NormalisedIngredient[]): NormalisedIngredient[] =>
  rows.reduce<NormalisedIngredient[]>((merged, row) => {
    const key = ingredientMergeKey(row.name);
    for (let index = 0; index < merged.length; index += 1) {
      const existing = merged[index]!;
      if (ingredientMergeKey(existing.name) !== key) {
        continue;
      }
      const amount = combineAmounts(existing, row);
      if (amount !== null) {
        return [...merged.slice(0, index), mergePair(existing, row, amount), ...merged.slice(index + 1)];
      }
    }
    return [...merged, row];
  }, []);
