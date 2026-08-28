import { describe, expect, it } from 'vitest';
import { coerceQuantityText, parseIngredientString } from './ingredientString.js';

describe('parseIngredientString', () => {
  it('parses quantity, unit, and name from a simple line', () => {
    expect(parseIngredientString('2 cups atta, sifted')).toEqual({
      raw: '2 cups atta, sifted',
      name: 'atta',
      quantity: 2,
      unit: 'cup',
      notes: 'sifted',
    });
  });

  it('parses a fraction quantity', () => {
    expect(parseIngredientString('1/2 cup Ragi Seeds')).toEqual({
      raw: '1/2 cup Ragi Seeds',
      name: 'Ragi Seeds',
      quantity: 0.5,
      unit: 'cup',
      notes: null,
    });
  });

  it('parses a mixed-number quantity', () => {
    expect(parseIngredientString('1 1/2 tsp salt').quantity).toBe(1.5);
  });

  it('extracts a trailing parenthetical as notes', () => {
    expect(parseIngredientString('1 cup White Urad Dal (Whole)')).toEqual({
      raw: '1 cup White Urad Dal (Whole)',
      name: 'White Urad Dal',
      quantity: 1,
      unit: 'cup',
      notes: 'Whole',
    });
  });

  it('keeps a Devanagari ingredient name intact', () => {
    expect(parseIngredientString('1/2 tsp हल्दी')).toEqual({
      raw: '1/2 tsp हल्दी',
      name: 'हल्दी',
      quantity: 0.5,
      unit: 'tsp',
      notes: null,
    });
  });

  it('never drops a line with no parseable quantity — falls back to raw + name only', () => {
    const result = parseIngredientString('Available in post please open the link');
    expect(result.raw).toBe('Available in post please open the link');
    expect(result.name).toBe('Available in post please open the link');
    expect(result.quantity).toBeNull();
    expect(result.unit).toBeNull();
  });

  it('accepts a quantity with no recognised unit, treating the rest as the name', () => {
    const result = parseIngredientString('3 eggs');
    expect(result.quantity).toBe(3);
    expect(result.unit).toBeNull();
    expect(result.name).toBe('eggs');
  });

  it('degrades a zero-denominator fraction to null quantity rather than Infinity', () => {
    const result = parseIngredientString('1/0 cup sugar');
    expect(result.quantity).toBeNull();
    expect(Number.isFinite(result.quantity ?? 0)).toBe(true);
  });

  it('degrades an implausibly large digit run to null quantity rather than Infinity', () => {
    const result = parseIngredientString(`${'9'.repeat(400)} cups flour`);
    expect(result.quantity).toBeNull();
  });
});

describe('coerceQuantityText', () => {
  it('coerces a clean numeric string to a number', () => {
    expect(coerceQuantityText('2')).toEqual({ quantity: 2, leftoverText: null });
  });

  it('coerces a fraction string to a number', () => {
    expect(coerceQuantityText('1/2')).toEqual({ quantity: 0.5, leftoverText: null });
  });

  it('falls back to null with the phrase preserved for vague text', () => {
    expect(coerceQuantityText('a fistful')).toEqual({ quantity: null, leftoverText: 'a fistful' });
    expect(coerceQuantityText('double the rava')).toEqual({ quantity: null, leftoverText: 'double the rava' });
  });

  it('treats an empty string as no quantity and no leftover text', () => {
    expect(coerceQuantityText('  ')).toEqual({ quantity: null, leftoverText: null });
  });

  it('preserves a zero-denominator fraction as leftover text rather than returning Infinity', () => {
    expect(coerceQuantityText('1/0')).toEqual({ quantity: null, leftoverText: '1/0' });
  });

  it('preserves an implausibly large digit run as leftover text rather than returning Infinity', () => {
    const huge = '9'.repeat(400);
    expect(coerceQuantityText(huge)).toEqual({ quantity: null, leftoverText: huge });
  });
});
