import { describe, expect, it } from 'vitest';
import {
  DIET_MODIFIERS,
  DIET_STYLES,
  eligibleRecipeStyleTags,
  expandStyle,
  householdModifiers,
  householdStyles,
  isRecipeEligible,
  reconcileHouseholdTags,
} from './dietMatch.js';

describe('dietMatch constants', () => {
  it('lists the five styles and two modifiers', () => {
    expect([...DIET_STYLES]).toEqual(['veg', 'non_veg', 'vegan', 'eggetarian', 'jain']);
    expect([...DIET_MODIFIERS]).toEqual(['gluten_free', 'dairy_free']);
  });
});

describe('expandStyle', () => {
  it.each([
    ['veg', ['veg', 'vegan', 'jain']],
    ['vegan', ['vegan']],
    ['jain', ['jain']],
    ['eggetarian', ['eggetarian', 'veg', 'vegan', 'jain']],
    ['non_veg', ['non_veg', 'eggetarian', 'veg', 'vegan', 'jain']],
  ] as const)('expands %s', (style, expected) => {
    expect([...expandStyle(style)].sort()).toEqual([...expected].sort());
  });
});

describe('householdStyles / householdModifiers', () => {
  it('splits tags, dedupes, and ignores unknown values', () => {
    const tags = ['veg', 'gluten_free', 'veg', 'bogus', 'dairy_free'];
    expect(householdStyles(tags)).toEqual(['veg']);
    expect(householdModifiers(tags)).toEqual(['gluten_free', 'dairy_free']);
  });
});

describe('eligibleRecipeStyleTags', () => {
  it('is the union of expansions', () => {
    expect([...eligibleRecipeStyleTags(['veg', 'jain'])].sort()).toEqual(['jain', 'vegan', 'veg'].sort());
    expect([...eligibleRecipeStyleTags(['vegan'])]).toEqual(['vegan']);
  });
  it('is empty when the household has no styles', () => {
    expect(eligibleRecipeStyleTags(['gluten_free'])).toEqual([]);
    expect(eligibleRecipeStyleTags([])).toEqual([]);
  });
});

describe('reconcileHouseholdTags (F1)', () => {
  it('returns the incoming tags as sent when they carry a style', () => {
    expect(reconcileHouseholdTags(['non_veg'], ['veg', 'gluten_free'])).toEqual(['non_veg']);
  });

  it('keeps stored styles and applies only the incoming modifiers', () => {
    expect(reconcileHouseholdTags(['dairy_free'], ['veg', 'jain', 'gluten_free'])).toEqual(['veg', 'jain', 'dairy_free']);
    expect(reconcileHouseholdTags([], ['veg', 'gluten_free'])).toEqual(['veg']);
  });

  it('accepts a style-less patch as sent when nothing stored has a style', () => {
    expect(reconcileHouseholdTags(['gluten_free'], [])).toEqual(['gluten_free']);
    expect(reconcileHouseholdTags([], ['gluten_free'])).toEqual([]);
  });
});

describe('isRecipeEligible', () => {
  it('regression: household [veg, eggetarian] accepts a recipe tagged only veg', () => {
    expect(isRecipeEligible(['veg'], ['veg', 'eggetarian'])).toBe(true);
  });
  it('veg household rejects non_veg and eggetarian-only recipes', () => {
    expect(isRecipeEligible(['non_veg'], ['veg'])).toBe(false);
    expect(isRecipeEligible(['eggetarian'], ['veg'])).toBe(false);
  });
  it('veg household accepts vegan and jain recipes', () => {
    expect(isRecipeEligible(['vegan'], ['veg'])).toBe(true);
    expect(isRecipeEligible(['jain'], ['veg'])).toBe(true);
  });
  it('eggetarian household accepts veg but not non_veg', () => {
    expect(isRecipeEligible(['veg'], ['eggetarian'])).toBe(true);
    expect(isRecipeEligible(['eggetarian'], ['eggetarian'])).toBe(true);
    expect(isRecipeEligible(['non_veg'], ['eggetarian'])).toBe(false);
  });
  it('non_veg household accepts every style', () => {
    for (const tag of DIET_STYLES) {
      expect(isRecipeEligible([tag], ['non_veg'])).toBe(true);
    }
  });
  it('vegan household accepts only vegan; jain only jain', () => {
    expect(isRecipeEligible(['veg'], ['vegan'])).toBe(false);
    expect(isRecipeEligible(['vegan'], ['vegan'])).toBe(true);
    expect(isRecipeEligible(['veg'], ['jain'])).toBe(false);
    expect(isRecipeEligible(['jain'], ['jain'])).toBe(true);
  });
  it('multi-tag recipes match if any tag is eligible', () => {
    expect(isRecipeEligible(['non_veg', 'veg'], ['vegan', 'veg'])).toBe(true);
  });
  it('styles combine as a union', () => {
    expect(isRecipeEligible(['jain'], ['vegan', 'jain'])).toBe(true);
    expect(isRecipeEligible(['vegan'], ['vegan', 'jain'])).toBe(true);
    expect(isRecipeEligible(['non_veg'], ['vegan', 'jain'])).toBe(false);
  });
  it('modifiers must all be present on the recipe', () => {
    expect(isRecipeEligible(['veg'], ['veg', 'gluten_free'])).toBe(false);
    expect(isRecipeEligible(['veg', 'gluten_free'], ['veg', 'gluten_free'])).toBe(true);
    expect(isRecipeEligible(['veg', 'gluten_free'], ['veg', 'gluten_free', 'dairy_free'])).toBe(false);
    expect(isRecipeEligible(['veg', 'gluten_free', 'dairy_free'], ['veg', 'gluten_free', 'dairy_free'])).toBe(true);
  });
  it('a household with no styles only applies modifiers', () => {
    expect(isRecipeEligible(['non_veg'], [])).toBe(true);
    expect(isRecipeEligible(['non_veg'], ['dairy_free'])).toBe(false);
    expect(isRecipeEligible(['dairy_free'], ['dairy_free'])).toBe(true);
  });
  it('a recipe with only a modifier tag never matches a styled household', () => {
    expect(isRecipeEligible(['gluten_free'], ['veg'])).toBe(false);
  });
  it('an empty recipe tag set fails a styled household', () => {
    expect(isRecipeEligible([], ['veg'])).toBe(false);
    expect(isRecipeEligible([], [])).toBe(true);
  });
});
