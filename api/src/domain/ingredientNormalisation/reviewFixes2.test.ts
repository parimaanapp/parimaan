import { describe, expect, it } from 'vitest';
import { parseIngredientString } from '../ingredientString.js';
import { toRecipeDraft } from '../../ai/schemas/recipeDraft.js';
import type { GeminiRecipeDraft } from '../../ai/schemas/recipeDraft.js';
import { ingredientMergeKey, mergeDuplicateIngredients } from './mergeIngredients.js';
import { normaliseIngredientList } from './index.js';
import type { NormalisedIngredient } from './normaliseIngredient.js';

const row = (name: string, quantity: number | null, unit: string | null): NormalisedIngredient => ({
  raw: name,
  name,
  quantity,
  unit,
  notes: null,
  isStaple: false,
});

const line = (text: string) => normaliseIngredientList([parseIngredientString(text)])[0]!;

const draftWith = (ingredients: GeminiRecipeDraft['ingredients']): GeminiRecipeDraft => ({ ingredients, steps: ['x'] });

describe('H1 — non-Latin names keep their combining marks in the merge key', () => {
  it.each([
    ['तेल', 'तिल'], // तेल vs तिल
    ['नेय', 'निय'], // vowel-sign-only difference
    ['நெய்', 'நய'], // நெய் vs ந ய style collision
  ])('keeps %j and %j separate', (a, b) => {
    expect(mergeDuplicateIngredients([row(a, 2, 'tbsp'), row(b, 1, 'tbsp')])).toHaveLength(2);
  });

  it('does not mangle a Tamil name in the key', () => {
    expect(ingredientMergeKey('நெய்')).toBe('நெய்');
  });

  it('treats canonically-equivalent spellings as the same ingredient', () => {
    expect(mergeDuplicateIngredients([row('café', 1, 'cup'), row('café', 1, 'cup')])).toHaveLength(1);
  });
});

describe('M3 — an empty key falls back to the raw lowercased name', () => {
  it.each([['\u{1F336}\u{FE0F}'], ['???'], ['(chopped)']])('key for %j is not empty', (name) => {
    expect(ingredientMergeKey(name)).not.toBe('');
  });

  it('does not merge unrelated emoji or punctuation-only rows', () => {
    expect(mergeDuplicateIngredients([row('\u{1F336}', 1, 'piece'), row('\u{1F345}', 1, 'piece')])).toHaveLength(2);
    expect(mergeDuplicateIngredients([row('???', 1, 'piece'), row('!!!', 1, 'piece')])).toHaveLength(2);
  });

  it('still merges identical fallback names', () => {
    expect(mergeDuplicateIngredients([row('???', 1, 'piece'), row('???', 2, 'piece')])).toHaveLength(1);
  });
});

describe('M2 — "no"/"nos" as a count unit only when safe', () => {
  it.each([
    ['2 nos tomato', 2, 'piece', 'tomato'],
    ['2 nos. tomato', 2, 'piece', 'tomato'],
    ['3 no onion', 3, 'piece', 'onion'],
    ['1 no. green chilli', 1, 'piece', 'green chilli'],
  ])('reads %j as a count', (text, quantity, unit, name) => {
    expect(line(text)).toMatchObject({ quantity, unit, name });
  });

  it.each([
    ['1 no salt added tomatoes', 'no salt added tomatoes'],
    ['1 no sugar jam', 'no sugar jam'],
    ['2 no fat yogurt', 'no fat yogurt'],
  ])('keeps the modifier in the name for %j', (text, name) => {
    expect(line(text)).toMatchObject({ quantity: expect.any(Number), unit: 'piece', name });
  });

  it('does not treat "no" as a unit without a leading quantity', () => {
    expect(parseIngredientString('no salt added tomatoes')).toMatchObject({ quantity: null, unit: null });
  });
});

describe('M1 — unicode fractions and ranges in the free-text (Gemini) path', () => {
  it.each([
    ['½', 0.5],
    ['1 ½', 1.5],
    ['1½', 1.5],
    ['¾', 0.75],
  ])('coerces quantity %j to %s', (quantity, expected) => {
    const result = toRecipeDraft(draftWith([{ name: 'milk', quantity, unit: 'cup', notes: null }])).ingredients[0]!;
    expect(result).toMatchObject({ quantity: expected, unit: 'cup', name: 'milk' });
  });

  it.each([['2-3'], ['2 to 3'], ['2–3']])('uses the lower bound for range %j and keeps the range in notes', (quantity) => {
    const result = toRecipeDraft(draftWith([{ name: 'green chillies', quantity, unit: null, notes: null }])).ingredients[0]!;
    expect(result).toMatchObject({ quantity: 2, unit: 'piece', name: 'green chillies', notes: '2-3' });
  });

  it('appends the range to existing notes', () => {
    const result = toRecipeDraft(draftWith([{ name: 'oil', quantity: '2-3', unit: 'tbsp', notes: 'for frying' }])).ingredients[0]!;
    expect(result).toMatchObject({ quantity: 2, unit: 'tbsp', notes: '2-3, for frying' });
  });

  it('accepts a thousands separator', () => {
    const result = toRecipeDraft(draftWith([{ name: 'flour', quantity: '1,000', unit: 'g', notes: null }])).ingredients[0]!;
    expect(result).toMatchObject({ quantity: 1000, unit: 'g' });
  });
});

describe('LOW — thousands separators and multipacks', () => {
  it('parses "1,000 g flour"', () => {
    expect(line('1,000 g flour')).toMatchObject({ quantity: 1000, unit: 'g', name: 'flour' });
  });

  it('parses "2 x 400 g can tomatoes" as 2 cans with a pack-size note', () => {
    expect(line('2 x 400 g can tomatoes')).toMatchObject({ quantity: 2, unit: 'can', name: 'tomatoes', notes: '400 g' });
  });

  it('parses "2 x 400g can chickpeas"', () => {
    expect(line('2 x 400g can chickpeas')).toMatchObject({ quantity: 2, unit: 'can', name: 'chickpeas', notes: '400 g' });
  });
});
