import { describe, expect, it } from 'vitest';
import { buildSettingsPatch } from './buildSettingsPatch';

interface Fixture {
  mealsEnabled: string[];
  mealStructure: string;
  cuisineTier1: string[];
}

const pristine: Fixture = {
  mealsEnabled: ['breakfast', 'lunch'],
  mealStructure: '{"lunch":{"carb":1,"sabzi_dal":1,"accompaniment":0}}',
  cuisineTier1: ['north_indian'],
};

describe('buildSettingsPatch', () => {
  // RED test 1 (pure-logic form): changing only one field produces a patch
  // containing ONLY that field.
  it('includes only the field that changed', () => {
    const current: Fixture = { ...pristine, mealsEnabled: ['breakfast', 'lunch', 'dinner'] };

    const patch = buildSettingsPatch(pristine, current, ['mealsEnabled', 'mealStructure', 'cuisineTier1']);

    expect(patch).toEqual({ mealsEnabled: ['breakfast', 'lunch', 'dinner'] });
    expect(Object.keys(patch)).toEqual(['mealsEnabled']);
  });

  // RED test 2 (pure-logic form): a different single-field change is
  // equally scoped — not a one-field fluke.
  it('includes only cuisineTier1 when only that field changed', () => {
    const current: Fixture = { ...pristine, cuisineTier1: ['north_indian', 'south_indian'] };

    const patch = buildSettingsPatch(pristine, current, ['mealsEnabled', 'mealStructure', 'cuisineTier1']);

    expect(patch).toEqual({ cuisineTier1: ['north_indian', 'south_indian'] });
    expect(Object.keys(patch)).toEqual(['cuisineTier1']);
  });

  it('returns an empty object when nothing changed', () => {
    const current: Fixture = { ...pristine };

    const patch = buildSettingsPatch(pristine, current, ['mealsEnabled', 'mealStructure', 'cuisineTier1']);

    expect(patch).toEqual({});
  });

  it('includes every changed field when multiple fields change', () => {
    const current: Fixture = {
      mealsEnabled: ['breakfast'],
      mealStructure: pristine.mealStructure,
      cuisineTier1: ['continental'],
    };

    const patch = buildSettingsPatch(pristine, current, ['mealsEnabled', 'mealStructure', 'cuisineTier1']);

    expect(patch).toEqual({ mealsEnabled: ['breakfast'], cuisineTier1: ['continental'] });
  });
});
