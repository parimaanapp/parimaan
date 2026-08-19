import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLERGENS,
  DEFAULT_CUISINE_TIER1,
  DEFAULT_CUISINE_TIER2_WEIGHTS,
  DEFAULT_DIETARY_TAGS,
  DEFAULT_MEALS_ENABLED,
  DEFAULT_MEAL_STRUCTURE,
  DEFAULT_SKIP_INGREDIENTS,
} from './householdDefaults.js';

describe('household settings defaults', () => {
  it('DEFAULT_MEALS_ENABLED matches the DDL default', () => {
    expect(DEFAULT_MEALS_ENABLED).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('DEFAULT_MEAL_STRUCTURE matches the DDL default JSON shape', () => {
    expect(DEFAULT_MEAL_STRUCTURE).toEqual({
      lunch: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
      dinner: { carb: 1, sabzi_dal: 2, accompaniment: 1 },
    });
  });

  it('DEFAULT_CUISINE_TIER1 matches the DDL default', () => {
    expect(DEFAULT_CUISINE_TIER1).toEqual(['north_indian']);
  });

  it('DEFAULT_CUISINE_TIER2_WEIGHTS matches the DDL default', () => {
    expect(DEFAULT_CUISINE_TIER2_WEIGHTS).toEqual({});
  });

  it('DEFAULT_DIETARY_TAGS matches the DDL default', () => {
    expect(DEFAULT_DIETARY_TAGS).toEqual([]);
  });

  it('DEFAULT_ALLERGENS matches the DDL default', () => {
    expect(DEFAULT_ALLERGENS).toEqual([]);
  });

  it('DEFAULT_SKIP_INGREDIENTS matches the DDL default', () => {
    expect(DEFAULT_SKIP_INGREDIENTS).toEqual([]);
  });

  it('constants are frozen (immutable)', () => {
    expect(Object.isFrozen(DEFAULT_MEALS_ENABLED)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MEAL_STRUCTURE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CUISINE_TIER1)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CUISINE_TIER2_WEIGHTS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_DIETARY_TAGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ALLERGENS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SKIP_INGREDIENTS)).toBe(true);
  });
});
