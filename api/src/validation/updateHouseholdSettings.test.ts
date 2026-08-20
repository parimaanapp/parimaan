import { describe, expect, it } from 'vitest';
import { updateHouseholdSettingsArgsSchema } from './updateHouseholdSettings.js';

const VALID_HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

describe('updateHouseholdSettingsArgsSchema', () => {
  it('rejects a non-UUID householdId', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: 'not-a-uuid',
      input: { allergens: ['peanuts'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an input with every field absent', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: {},
    });
    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.issues[0]?.message).toBe(
      'Input must contain at least one field to update.',
    );
  });

  it('rejects an explicit null for a field (not supported — only absence means "leave unchanged")', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { allergens: null },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a single-field patch: mealsEnabled', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { mealsEnabled: ['breakfast', 'dinner'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid MealType enum value in mealsEnabled', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { mealsEnabled: ['brunch'] },
    });
    expect(result.success).toBe(false);
  });

  it('accepts mealStructure as an AWSJSON *string* and parses it', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: {
        mealStructure: JSON.stringify({
          lunch: { carb: 2, sabzi_dal: 1, accompaniment: 0 },
        }),
      },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.input.mealStructure).toEqual({
      lunch: { carb: 2, sabzi_dal: 1, accompaniment: 0 },
    });
  });

  it('accepts mealStructure as an already-parsed object (defensive tolerance)', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: {
        mealStructure: { dinner: { carb: 1, sabzi_dal: 2, accompaniment: 1 } },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a mealStructure string that is not valid JSON', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { mealStructure: '{not valid json' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an oversized mealStructure JSON string before it ever reaches JSON.parse', () => {
    // A valid mealStructure entry is a handful of short keys/small integers —
    // no legitimate payload approaches this size. Guards against handing an
    // unbounded string to JSON.parse.
    const oversized = JSON.stringify({
      lunch: { carb: 1, sabzi_dal: 1, accompaniment: 1, padding: 'x'.repeat(9_000) },
    });
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { mealStructure: oversized },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a mealStructure with an invalid meal-type key', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { mealStructure: { brunch: { carb: 1, sabzi_dal: 1, accompaniment: 1 } } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a mealStructure count outside 0-10', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { mealStructure: { lunch: { carb: 11, sabzi_dal: 1, accompaniment: 1 } } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer mealStructure count', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { mealStructure: { lunch: { carb: 1.5, sabzi_dal: 1, accompaniment: 1 } } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts cuisineTier2Weights as an AWSJSON string with valid weight values', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { cuisineTier2Weights: JSON.stringify({ south_indian: 'more', continental: 'less' }) },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a cuisineTier2Weights value outside more/normal/less', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { cuisineTier2Weights: { south_indian: 'extreme' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects cuisineTier2Weights with more than 20 keys', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`cuisine_${i}`, 'more']),
    );
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { cuisineTier2Weights: tooMany },
    });
    expect(result.success).toBe(false);
  });

  it('rejects cuisineTier2Weights with a key longer than 40 characters', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: { cuisineTier2Weights: { ['x'.repeat(41)]: 'more' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a full multi-field patch', () => {
    const result = updateHouseholdSettingsArgsSchema.safeParse({
      householdId: VALID_HOUSEHOLD_ID,
      input: {
        cuisineTier1: ['south_indian', 'pan_india'],
        dietaryTags: ['veg', 'jain'],
        allergens: ['peanuts', 'shellfish'],
        skipIngredients: ['cilantro'],
      },
    });
    expect(result.success).toBe(true);
  });
});
