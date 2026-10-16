import { describe, expect, it } from 'vitest';
import { roundShoppingQuantity } from './shoppingQuantityRounding.js';

describe('roundShoppingQuantity', () => {
  it('leaves null alone', () => {
    expect(roundShoppingQuantity(null, 'bunch')).toBeNull();
  });

  describe('count-like units (bunch, piece, ...)', () => {
    it('rounds UP to the next 0.5 when the amount is not already a half step', () => {
      expect(roundShoppingQuantity(7.28, 'bunch')).toBe(7.5);
      expect(roundShoppingQuantity(7.283, 'bunch')).toBe(7.5);
      expect(roundShoppingQuantity(7.001, 'bunch')).toBe(7.5);
      expect(roundShoppingQuantity(7.501, 'bunch')).toBe(8);
      expect(roundShoppingQuantity(2.7777, 'piece')).toBe(3);
    });

    it('never rounds below the true need', () => {
      for (const q of [0.0101, 1.3333, 2.4999, 6.9971, 13.1234]) {
        expect(roundShoppingQuantity(q, 'piece')!).toBeGreaterThanOrEqual(q);
        expect(roundShoppingQuantity(q, 'bunch')!).toBeGreaterThanOrEqual(q);
      }
    });

    it('keeps whole numbers and halves untouched', () => {
      expect(roundShoppingQuantity(3, 'piece')).toBe(3);
      expect(roundShoppingQuantity(2.5, 'bunch')).toBe(2.5);
      expect(roundShoppingQuantity(0.25, 'piece')).toBe(0.5);
    });

    it('ignores floating point noise from summing', () => {
      expect(roundShoppingQuantity(0.1 + 0.2, 'piece')).toBe(0.5);
      expect(roundShoppingQuantity(0.5 + 1e-12, 'piece')).toBe(0.5);
      expect(roundShoppingQuantity(43.00000000000001, 'piece')).toBe(43);
    });

    it('covers the other count-like units', () => {
      for (const unit of ['dozen', 'slice', 'pack', 'packet', 'loaf', 'bottle', 'jar']) {
        expect(roundShoppingQuantity(1.2345, unit)).toBe(1.5);
      }
    });
  });

  describe('measured units', () => {
    it('keeps g, ml, kg, l and others to at most 2 decimals', () => {
      expect(roundShoppingQuantity(123.4567, 'g')).toBe(123.46);
      expect(roundShoppingQuantity(0.33333, 'kg')).toBe(0.33);
      expect(roundShoppingQuantity(250.004, 'ml')).toBe(250);
      expect(roundShoppingQuantity(1.0049, 'l')).toBe(1);
      expect(roundShoppingQuantity(1.6667, 'cup')).toBe(1.67);
    });

    it('is a no-op for values already at 2 decimals or fewer', () => {
      expect(roundShoppingQuantity(150, 'g')).toBe(150);
      expect(roundShoppingQuantity(0.75, 'cup')).toBe(0.75);
    });
  });

  it('treats a null unit as a count-free measure (2 decimals)', () => {
    expect(roundShoppingQuantity(1.2345, null)).toBe(1.23);
  });

  it('is case-insensitive on the unit', () => {
    expect(roundShoppingQuantity(1.2345, 'Bunch')).toBe(1.5);
  });
});
