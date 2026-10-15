import { describe, expect, it } from 'vitest';
import { parseIngredientString } from '../ingredientString.js';
import { cleanText, decodeHtmlEntities } from './text.js';
import { mergeDuplicateIngredients } from './mergeIngredients.js';
import { normaliseIngredientList } from './index.js';
import { normaliseIngredient } from './normaliseIngredient.js';
import type { NormalisedIngredient } from './normaliseIngredient.js';

const row = (name: string, quantity: number | null, unit: string | null, extra: Partial<NormalisedIngredient> = {}): NormalisedIngredient => ({
  raw: name,
  name,
  quantity,
  unit,
  notes: extra.notes ?? null,
  isStaple: extra.isStaple ?? false,
});

const line = (text: string) => normaliseIngredientList([parseIngredientString(text)])[0]!;

describe('HIGH 1 — merge key is linear-time on adversarial input', () => {
  const hostile = `1 cup ${'('.repeat(100_000)}`;

  it('merges 100k parentheses in under 100 ms', () => {
    const hostileRows = [row(hostile, 1, 'cup'), row(hostile, 1, 'cup')];
    const start = performance.now();
    mergeDuplicateIngredients(hostileRows);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('parses and normalises the same hostile line in under 100 ms', () => {
    const start = performance.now();
    normaliseIngredientList([parseIngredientString(hostile)]);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('caps the name length used for keying so a long unique prefix cannot dominate', () => {
    const start = performance.now();
    mergeDuplicateIngredients(Array.from({ length: 200 }, (_, i) => row(`${'a'.repeat(5000)}${i}`, 1, 'g')));
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('HIGH 2 — a parsed quantity is never dropped by a to-taste phrase', () => {
  it('keeps 1 tsp for "1 tsp salt, plus more to taste"', () => {
    expect(line('1 tsp salt, plus more to taste')).toMatchObject({ name: 'salt', quantity: 1, unit: 'tsp', notes: 'plus more to taste', isStaple: true });
  });

  it('keeps 2 tbsp for "2 tbsp oil, as needed for frying"', () => {
    expect(line('2 tbsp oil, as needed for frying')).toMatchObject({ name: 'oil', quantity: 2, unit: 'tbsp', notes: 'as needed for frying' });
  });

  it('keeps the quantity and moves an inline phrase out of the name', () => {
    expect(line('1 tsp salt or to taste')).toMatchObject({ name: 'salt', quantity: 1, unit: 'tsp', isStaple: true });
  });

  it('still clears quantity when none was parsed', () => {
    expect(line('salt to taste')).toMatchObject({ name: 'salt', quantity: null, unit: null, isStaple: true });
  });
});

describe('HIGH 3 — distinguishing parentheticals stay in the merge key', () => {
  it.each([
    ['Dal (whole)', 'Dal (split)'],
    ['Chilli (green)', 'Chilli (red)'],
    ['Dal (whole)', 'Dal'],
  ])('keeps %j and %j separate', (a, b) => {
    expect(mergeDuplicateIngredients([row(a, 1, 'cup'), row(b, 1, 'cup')])).toHaveLength(2);
  });

  it.each([
    ['Onion (chopped)', 'Onion'],
    ['Onion (finely chopped)', 'onion (sliced)'],
    ['Ginger (grated, optional)', 'Ginger'],
    ['Coriander (fresh)', 'Coriander'],
    ['Tomato (about 2 medium)', 'Tomato'],
    ['Garlic (minced)', 'Garlic (crushed)'],
  ])('merges %j and %j', (a, b) => {
    expect(mergeDuplicateIngredients([row(a, 1, 'piece'), row(b, 1, 'piece')])).toHaveLength(1);
  });
});

describe('MEDIUM 4 — unit aliases', () => {
  it('does not turn "1 no salt added tomatoes" into a counted unit', () => {
    expect(line('1 no salt added tomatoes')).toMatchObject({ name: 'no salt added tomatoes', quantity: 1, unit: 'piece' });
  });

  it('puts clove as a distinct unit and keeps the ingredient name', () => {
    expect(line('2 cloves garlic')).toMatchObject({ name: 'garlic', quantity: 2, unit: 'clove' });
  });

  it('keeps "6 cloves" (the spice) as the name with piece', () => {
    expect(line('6 cloves')).toMatchObject({ name: 'cloves', quantity: 6, unit: 'piece' });
  });

  it('converts lb to g without leaking the unit word', () => {
    expect(line('1 lb potatoes')).toMatchObject({ name: 'potatoes', quantity: 453.6, unit: 'g' });
  });

  it('converts oz to g', () => {
    expect(line('2 oz butter')).toMatchObject({ name: 'butter', quantity: 56.7, unit: 'g' });
  });

  it('keeps can as a unit and out of the name', () => {
    expect(line('1 can tomato')).toMatchObject({ name: 'tomato', quantity: 1, unit: 'can' });
  });
});

describe('MEDIUM 5 — unicode fractions and ranges', () => {
  it.each([
    ['½ cup milk', 0.5, 'cup', 'milk'],
    ['1½ cups flour', 1.5, 'cup', 'flour'],
    ['⅓ tsp salt', 1 / 3, 'tsp', 'salt'],
    ['¾ cup sugar', 0.75, 'cup', 'sugar'],
    ['⅛ tsp cardamom', 0.125, 'tsp', 'cardamom'],
    ['1 ¼ cup rice', 1.25, 'cup', 'rice'],
  ])('parses %j', (text, quantity, unit, name) => {
    const result = parseIngredientString(text);
    expect(result.quantity).toBeCloseTo(quantity, 6);
    expect(result).toMatchObject({ unit, name });
  });

  it.each([
    ['2-3 tbsp oil', 2, 'tbsp', 'oil', '2-3'],
    ['2 to 3 tbsp oil', 2, 'tbsp', 'oil', '2-3'],
    ['2–3 green chillies', 2, null, 'green chillies', '2-3'],
  ])('uses the lower bound for range %j', (text, quantity, unit, name, note) => {
    expect(parseIngredientString(text)).toMatchObject({ quantity, unit, name, notes: note });
  });

  it('never leaves a fraction character in the name', () => {
    expect(parseIngredientString('salt ½').name).not.toMatch(/[¼-¾⅐-⅞]/);
  });
});

describe('MEDIUM 6 — staple matching and merge flag', () => {
  it.each([
    ['salt', true],
    ['sea salt', true],
    ['rock salt', true],
    ['black salt', true],
    ['pepper', true],
    ['black pepper', true],
    ['white pepper', true],
    ['pepper powder', true],
    ['pepper jack cheese', false],
    ['bell pepper', false],
    ['salt-free seasoning', false],
    ['salted butter', false],
    ['salt substitute blend', false],
  ])('to-taste %j staple=%s', (name, expected) => {
    expect(normaliseIngredient({ raw: `${name} to taste`, name: `${name} to taste`, quantity: null, unit: null, notes: null }).isStaple).toBe(expected);
  });

  it('a merged salt/pepper row with a measured quantity stays staple', () => {
    const merged = mergeDuplicateIngredients([row('Salt', null, null, { isStaple: true }), row('Salt', 1, 'tsp')]);
    expect(merged[0]).toMatchObject({ quantity: 1, unit: 'tsp', isStaple: true });
  });

  it('a merged non salt/pepper measured row is staple only if every source was', () => {
    const merged = mergeDuplicateIngredients([row('Oil', null, null, { isStaple: true }), row('Oil', 1, 'tsp')]);
    expect(merged[0]).toMatchObject({ quantity: 1, unit: 'tsp', isStaple: false });
  });

  it('stays staple when every source row was staple', () => {
    const merged = mergeDuplicateIngredients([row('Salt', null, null, { isStaple: true }), row('Salt', null, null, { isStaple: true })]);
    expect(merged[0]!.isStaple).toBe(true);
  });
});

describe('MEDIUM 7 — entity decoding', () => {
  it('decodes exactly once', () => {
    expect(decodeHtmlEntities('&amp;quot;x&amp;quot;')).toBe('&quot;x&quot;');
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });

  it.each([['&#xD800;'], ['&#55296;'], ['&#xDFFF;'], ['&#0;'], ['&#7;'], ['&#x1F;'], ['&#127;'], ['&#x80;']])('does not decode %j', (entity) => {
    expect(decodeHtmlEntities(`a${entity}b`)).toBe(`a${entity}b`);
  });

  it('keeps tab and newline as whitespace and strips raw control characters', () => {
    const withControls = `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c${String.fromCharCode(127)}\td\ne`;
    expect(cleanText(withControls)).toBe('abc d e');
  });

  it('decodes &#9; and &#10; as whitespace', () => {
    expect(cleanText('a&#9;b&#10;c')).toBe('a b c');
  });
});
