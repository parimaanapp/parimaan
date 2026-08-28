import { describe, expect, it } from 'vitest';
import { parseRecipeYield } from './yield.js';

describe('parseRecipeYield', () => {
  it('accepts a bare number', () => {
    expect(parseRecipeYield(4)).toBe(4);
  });

  it('extracts a leading number from a descriptive string', () => {
    expect(parseRecipeYield('4 servings')).toBe(4);
  });

  it('returns null when the number is not at the start of the string', () => {
    expect(parseRecipeYield('makes 12 laddoos')).toBeNull();
  });

  it('picks the first parseable entry from an array (the common real-world shape)', () => {
    expect(parseRecipeYield(['4', '4 people'])).toBe(4);
    expect(parseRecipeYield(['25', '25 pieces'])).toBe(25);
  });

  it('falls through array entries until one parses', () => {
    expect(parseRecipeYield(['makes a lot', '6'])).toBe(6);
  });

  it('returns null for missing, empty, or zero values', () => {
    expect(parseRecipeYield(undefined)).toBeNull();
    expect(parseRecipeYield('')).toBeNull();
    expect(parseRecipeYield(0)).toBeNull();
  });

  it('returns null for an adversarial digit run in the string branch, not Infinity', () => {
    expect(parseRecipeYield(`${'9'.repeat(400)} servings`)).toBeNull();
  });

  it('returns null for an implausibly large numeric yield', () => {
    expect(parseRecipeYield(50_000)).toBeNull();
  });
});
