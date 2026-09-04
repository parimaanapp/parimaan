import { describe, expect, it } from 'vitest';
import { KNOWN_PANTRY_CATEGORIES } from './pantryCategories.js';
import { DEFAULT_EXPIRY_DAYS_BY_CATEGORY, defaultExpiryDaysForCategory } from './defaultExpiry.js';

describe('defaultExpiryDaysForCategory', () => {
  it.each(KNOWN_PANTRY_CATEGORIES.map((category) => [category, DEFAULT_EXPIRY_DAYS_BY_CATEGORY[category]] as const))(
    'returns %s’s configured day count (%s)',
    (category, expected) => {
      expect(defaultExpiryDaysForCategory(category)).toBe(expected);
    },
  );

  it('returns null for "other" (no default)', () => {
    expect(defaultExpiryDaysForCategory('other')).toBeNull();
  });

  it('returns null for an unrecognized category', () => {
    expect(defaultExpiryDaysForCategory('nonexistent')).toBeNull();
  });

  it('normalizes case and whitespace the same way canonicalizePantryCategory does', () => {
    expect(defaultExpiryDaysForCategory(' Dairy ')).toBe(5);
  });
});
