import { describe, expect, it } from 'vitest';
import { convertQuantity } from './unitConversion.js';

describe('convertQuantity', () => {
  it('converts within the mass family (g <-> kg)', () => {
    expect(convertQuantity(2000, 'g', 'kg')).toBeCloseTo(2, 6);
    expect(convertQuantity(1.5, 'kg', 'g')).toBeCloseTo(1500, 6);
  });

  it('converts within the volume family (ml, l, tsp, tbsp, cup)', () => {
    expect(convertQuantity(2000, 'ml', 'l')).toBeCloseTo(2, 6);
    expect(convertQuantity(3, 'tsp', 'tbsp')).toBeCloseTo(1, 3);
    expect(convertQuantity(16, 'tbsp', 'cup')).toBeCloseTo(1, 3);
    expect(convertQuantity(1, 'cup', 'ml')).toBeCloseTo(236.588, 3);
  });

  it('returns null across families (mass vs volume)', () => {
    expect(convertQuantity(2, 'cup', 'g')).toBeNull();
    expect(convertQuantity(500, 'g', 'ml')).toBeNull();
  });

  it('returns null for count-only units (piece, packet, bunch) against a convertible family', () => {
    expect(convertQuantity(2, 'piece', 'g')).toBeNull();
    expect(convertQuantity(2, 'packet', 'ml')).toBeNull();
    expect(convertQuantity(2, 'bunch', 'kg')).toBeNull();
  });

  it('returns null between two different count-only units — no conversion, not even a guess', () => {
    expect(convertQuantity(2, 'piece', 'packet')).toBeNull();
  });

  it('returns the quantity unchanged for an identical unit, known or not', () => {
    expect(convertQuantity(3, 'piece', 'piece')).toBe(3);
    expect(convertQuantity(4, 'dozen', 'dozen')).toBe(4);
  });

  it('returns null for an unrecognised unit paired with a known convertible one', () => {
    expect(convertQuantity(2, 'dozen', 'g')).toBeNull();
  });

  it('canonicalizes case/whitespace before matching (KG vs kg)', () => {
    expect(convertQuantity(1, 'KG', ' g ')).toBeCloseTo(1000, 6);
  });
});
