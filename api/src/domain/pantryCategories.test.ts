import { describe, expect, it } from 'vitest';
import { KNOWN_PANTRY_CATEGORIES, canonicalizePantryCategory } from './pantryCategories.js';

describe('KNOWN_PANTRY_CATEGORIES', () => {
  it('matches the approved ingredient category set, in order', () => {
    expect([...KNOWN_PANTRY_CATEGORIES]).toEqual([
      'dal',
      'grain',
      'spice',
      'dairy',
      'eggs',
      'produce',
      'dry_goods',
      'oil',
      'meat_fish',
      'condiment',
      'bakery',
      'snacks',
      'beverages',
      'frozen',
      'other',
    ]);
  });

  it('recognises the new categories case-insensitively', () => {
    expect(canonicalizePantryCategory(' Meat_Fish ')).toBe('meat_fish');
  });
});

describe('canonicalizePantryCategory', () => {
  it.each(KNOWN_PANTRY_CATEGORIES)('passes a known category %s through unchanged', (category) => {
    expect(canonicalizePantryCategory(category)).toBe(category);
  });

  it('lowercases a known category typed in a different case', () => {
    expect(canonicalizePantryCategory('DAL')).toBe('dal');
    expect(canonicalizePantryCategory('Dry_Goods')).toBe('dry_goods');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(canonicalizePantryCategory('  dal  ')).toBe('dal');
  });

  it('passes an unrecognised category through as-is (trimmed), not rejected', () => {
    expect(canonicalizePantryCategory('  festival snacks  ')).toBe('festival snacks');
  });
});
