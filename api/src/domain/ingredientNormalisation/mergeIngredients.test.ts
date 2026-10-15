import { describe, expect, it } from 'vitest';
import { mergeDuplicateIngredients } from './mergeIngredients.js';
import type { NormalisedIngredient } from './normaliseIngredient.js';

const row = (name: string, quantity: number | null, unit: string | null, extra: Partial<NormalisedIngredient> = {}): NormalisedIngredient => ({
  raw: extra.raw ?? name,
  name,
  quantity,
  unit,
  notes: extra.notes ?? null,
  isStaple: extra.isStaple ?? false,
});

describe('mergeDuplicateIngredients — summing', () => {
  it.each([
    ['same unit', row('Water', 100, 'ml'), row('water', 50, 'ml'), 150, 'ml'],
    ['g and kg keeps first unit', row('Flour', 500, 'g'), row('Flour', 1, 'kg'), 1500, 'g'],
    ['kg and g keeps first unit', row('Flour', 1, 'kg'), row('Flour', 500, 'g'), 1.5, 'kg'],
    ['ml and l', row('Milk', 250, 'ml'), row('Milk', 1, 'l'), 1250, 'ml'],
    ['tsp and tbsp, tbsp first', row('Oil', 1, 'tbsp'), row('Oil', 3, 'tsp'), 2, 'tbsp'],
    ['tsp and tbsp, tsp first', row('Oil', 1, 'tsp'), row('Oil', 1, 'tbsp'), 4, 'tsp'],
    ['cup and cup', row('Water', 0.5, 'cup'), row('Water', 0.5, 'cup'), 1, 'cup'],
    ['cup then ml uses 240 ml per cup, result in ml', row('Water', 1, 'cup'), row('Water', 100, 'ml'), 340, 'ml'],
    ['ml then cup', row('Water', 100, 'ml'), row('Water', 0.5, 'cup'), 220, 'ml'],
    ['null units equal', row('Egg', 2, null), row('Egg', 1, null), 3, null],
    ['avoids float noise', row('Oil', 0.1, 'tsp'), row('Oil', 0.2, 'tsp'), 0.3, 'tsp'],
  ])('%s', (_label, a, b, quantity, unit) => {
    const result = mergeDuplicateIngredients([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(quantity);
    expect(result[0]!.unit).toBe(unit);
  });
});

describe('mergeDuplicateIngredients — separate rows', () => {
  it.each([
    ['mass vs volume', row('Honey', 100, 'g'), row('Honey', 1, 'tbsp')],
    ['cup vs g', row('Rice', 1, 'cup'), row('Rice', 100, 'g')],
    ['cup vs tbsp', row('Water', 1, 'cup'), row('Water', 1, 'tbsp')],
    ['piece vs g', row('Onion', 2, 'piece'), row('Onion', 100, 'g')],
    ['different names', row('Onion', 1, 'piece'), row('Tomato', 1, 'piece')],
    ['unitless vs unit', row('Egg', 2, null), row('Egg', 1, 'bunch')],
  ])('keeps %s separate', (_label, a, b) => {
    expect(mergeDuplicateIngredients([a, b])).toHaveLength(2);
  });
});

describe('mergeDuplicateIngredients — name keys', () => {
  it.each([
    ['case', 'Red Chilli Powder', 'red chilli powder'],
    ['whitespace', 'Red  Chilli   Powder', 'Red Chilli Powder '],
    ['punctuation', 'Red Chilli Powder.', 'red-chilli powder'],
    ['parenthetical', 'Ginger Garlic Paste (fresh)', 'Ginger garlic paste'],
  ])('treats names as equal ignoring %s', (_label, a, b) => {
    expect(mergeDuplicateIngredients([row(a, 1, 'tbsp'), row(b, 1, 'tbsp')])).toHaveLength(1);
  });

  it('keeps the first row name and position', () => {
    const result = mergeDuplicateIngredients([row('Onion', 1, 'piece'), row('Water', 1, 'cup'), row('onion', 2, 'piece')]);
    expect(result.map((r) => r.name)).toEqual(['Onion', 'Water']);
    expect(result[0]!.quantity).toBe(3);
  });
});

describe('mergeDuplicateIngredients — null quantities, staples, notes', () => {
  it('keeps the quantity of the row that has one when the other is quantity-less', () => {
    const result = mergeDuplicateIngredients([row('Salt', 1, 'tsp'), row('Salt', null, null, { isStaple: true })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ quantity: 1, unit: 'tsp', isStaple: false });
  });

  it('keeps null quantity when both are quantity-less', () => {
    const result = mergeDuplicateIngredients([row('Salt', null, null, { isStaple: true }), row('Salt', null, null, { isStaple: true })]);
    expect(result).toEqual([row('Salt', null, null, { isStaple: true })]);
  });

  it('ORs isStaple when no measured quantity results', () => {
    expect(mergeDuplicateIngredients([row('Salt', null, null), row('Salt', null, null, { isStaple: true })])[0]!.isStaple).toBe(true);
  });

  it('concatenates distinct notes only', () => {
    const result = mergeDuplicateIngredients([
      row('Onion', 1, 'piece', { notes: 'chopped' }),
      row('Onion', 1, 'piece', { notes: 'Chopped' }),
      row('Onion', 1, 'piece', { notes: 'for garnish' }),
      row('Onion', 1, 'piece'),
    ]);
    expect(result[0]!.notes).toBe('chopped, for garnish');
  });

  it('does not mutate its input', () => {
    const input = [row('Water', 1, 'cup'), row('Water', 1, 'cup')];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeDuplicateIngredients(input);
    expect(input).toEqual(snapshot);
  });

  it('returns an empty list for an empty list', () => {
    expect(mergeDuplicateIngredients([])).toEqual([]);
  });

  it('merges a later row into a compatible earlier row when an intermediate row is incompatible', () => {
    const result = mergeDuplicateIngredients([row('Onion', 2, 'piece'), row('Onion', 100, 'g'), row('Onion', 1, 'piece')]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ quantity: 3, unit: 'piece' });
    expect(result[1]).toMatchObject({ quantity: 100, unit: 'g' });
  });
});
