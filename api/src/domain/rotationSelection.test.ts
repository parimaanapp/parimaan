import { describe, expect, it } from 'vitest';
import { DEFAULT_MEALS_ENABLED, DEFAULT_MEAL_STRUCTURE } from './householdDefaults.js';
import type {
  EmptySlot,
  ExistingMenuItemSlot,
  RotationHouseholdSettings,
  WeightedCandidate,
} from './rotationSelection.js';
import {
  RECENCY_WINDOW_WEEKS,
  enumerateEmptySlots,
  pickForSlots,
  scoreCandidate,
} from './rotationSelection.js';

const DEFAULT_SETTINGS: RotationHouseholdSettings = {
  mealsEnabled: DEFAULT_MEALS_ENABLED,
  mealStructure: DEFAULT_MEAL_STRUCTURE as unknown as Record<string, unknown>,
};

describe('enumerateEmptySlots', () => {
  it('a default-settings household with no items yields the exact configured total: 63 slots (9/day x 7 days)', () => {
    const slots = enumerateEmptySlots(DEFAULT_SETTINGS, []);
    // 1 breakfast + (1 carb + 2 sabzi_dal + 1 accompaniment) lunch + same for dinner = 9/day.
    expect(slots).toHaveLength(63);
  });

  it.each([
    ['breakfast', 1],
    ['lunch', 4],
    ['dinner', 4],
  ])('yields exactly %s slots for %s per day, table-driven not one sampled number', (mealSlot, expectedPerDay) => {
    const slots = enumerateEmptySlots(DEFAULT_SETTINGS, []);
    const forDayZero = slots.filter((slot) => slot.dayOfWeek === 0 && slot.mealSlot === mealSlot);
    expect(forDayZero).toHaveLength(expectedPerDay);
  });

  it('a disabled meal type contributes zero slots, for every day', () => {
    const settings: RotationHouseholdSettings = { ...DEFAULT_SETTINGS, mealsEnabled: ['lunch', 'dinner'] };
    const slots = enumerateEmptySlots(settings, []);
    expect(slots.some((slot) => slot.mealSlot === 'breakfast')).toBe(false);
    expect(slots).toHaveLength(56); // 63 - 7 breakfast slots
  });

  it('malformed mealStructure contributes zero lunch/dinner slots, never "unlimited" — fails closed like getMealSlotCap', () => {
    const settings: RotationHouseholdSettings = { ...DEFAULT_SETTINGS, mealStructure: { lunch: 'not an object' } };
    const slots = enumerateEmptySlots(settings, []);
    expect(slots.filter((slot) => slot.mealSlot === 'lunch' || slot.mealSlot === 'dinner')).toHaveLength(0);
    // breakfast is unaffected — it never reads mealStructure at all.
    expect(slots.filter((slot) => slot.mealSlot === 'breakfast')).toHaveLength(7);
  });

  it('partially-filled slots reduce the enumeration by exactly the filled count, for that (day, mealSlot, slotRole) triple only', () => {
    const existingItems: ExistingMenuItemSlot[] = [
      { dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' }, // cap is 2, one filled -> one slot left
      { dayOfWeek: 0, mealSlot: 'breakfast', slotRole: 'breakfast' }, // cap is 1, filled -> zero slots left
    ];
    const slots = enumerateEmptySlots(DEFAULT_SETTINGS, existingItems);

    const dayZeroLunchSabzi = slots.filter(
      (slot) => slot.dayOfWeek === 0 && slot.mealSlot === 'lunch' && slot.slotRole === 'sabzi_dal',
    );
    expect(dayZeroLunchSabzi).toHaveLength(1);

    const dayZeroBreakfast = slots.filter((slot) => slot.dayOfWeek === 0 && slot.mealSlot === 'breakfast');
    expect(dayZeroBreakfast).toHaveLength(0);

    // day 1's breakfast is untouched by day 0's fill.
    const dayOneBreakfast = slots.filter((slot) => slot.dayOfWeek === 1 && slot.mealSlot === 'breakfast');
    expect(dayOneBreakfast).toHaveLength(1);
  });

  it('more existing items than the configured cap yields zero (never negative) slots for that triple — the shrunk-mealStructure scenario meal_slot_plan.dart documents', () => {
    const existingItems: ExistingMenuItemSlot[] = [
      { dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' },
      { dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' },
      { dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'sabzi_dal' }, // cap is 2, three already placed
    ];
    const slots = enumerateEmptySlots(DEFAULT_SETTINGS, existingItems);
    expect(slots.filter((slot) => slot.dayOfWeek === 0 && slot.mealSlot === 'lunch' && slot.slotRole === 'sabzi_dal')).toHaveLength(0);
  });

  it('breakfast/snacks slots carry the fixed role-agnostic role (breakfast/snack), matching meal_slot_plan.dart\'s own fallback', () => {
    const settings: RotationHouseholdSettings = { ...DEFAULT_SETTINGS, mealsEnabled: ['breakfast', 'snacks'] };
    const slots = enumerateEmptySlots(settings, []);
    const breakfastSlot = slots.find((slot) => slot.mealSlot === 'breakfast' && slot.dayOfWeek === 0);
    const snacksSlot = slots.find((slot) => slot.mealSlot === 'snacks' && slot.dayOfWeek === 0);
    expect(breakfastSlot?.slotRole).toBe('breakfast');
    expect(snacksSlot?.slotRole).toBe('snack');
  });
});

describe('scoreCandidate', () => {
  it('never returns a weight of 0, for any input — a bias must never become a hard filter', () => {
    const weight = scoreCandidate(
      { recipeId: 'r1', cuisineTier1: 'south_indian', cuisineTier2: 'kerala' },
      ['north_indian'],
      { kerala: 'less' },
      1,
    );
    expect(weight).toBeGreaterThan(0);
  });

  it('applies the tier-1 bonus only when the household\'s cuisineTier1 array includes the recipe\'s own', () => {
    const matching = scoreCandidate({ recipeId: 'r1', cuisineTier1: 'north_indian', cuisineTier2: null }, ['north_indian'], {}, null);
    const nonMatching = scoreCandidate({ recipeId: 'r2', cuisineTier1: 'south_indian', cuisineTier2: null }, ['north_indian'], {}, null);
    expect(matching).toBeGreaterThan(nonMatching);
  });

  it('a \'less\'-weighted cuisine still scores above zero — bias, never a hard filter (PRD §7.3)', () => {
    const weight = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: 'kerala' }, [], { kerala: 'less' }, null);
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(1); // still penalized relative to the 1.0 base
  });

  it('a recipe with null cuisine columns keeps base weight, never zero — uncategorised must not become unpickable', () => {
    const weight = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: null }, ['north_indian'], { anything: 'more' }, null);
    expect(weight).toBe(1);
  });

  it('a malformed cuisineTier2Weights value (not "more"/"normal"/"less") degrades to the normal multiplier, never NaN or a throw', () => {
    const weight = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: 'kerala' }, [], { kerala: 'bogus-value' }, null);
    expect(weight).toBe(1); // same as TIER2_WEIGHT_MULTIPLIER.normal
    expect(Number.isNaN(weight)).toBe(false);

    const nonStringWeight = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: 'kerala' }, [], { kerala: 42 as unknown as string }, null);
    expect(nonStringWeight).toBe(1);
  });

  it.each([
    [1, RECENCY_WINDOW_WEEKS], // last week -> heaviest penalty
    [2, RECENCY_WINDOW_WEEKS],
    [3, RECENCY_WINDOW_WEEKS],
  ])('recency penalty for weeksAgo=%i is a real penalty within the %i-week window', (weeksAgo) => {
    const penalized = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: null }, [], {}, weeksAgo);
    const unpenalized = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: null }, [], {}, null);
    expect(penalized).toBeLessThan(unpenalized);
    expect(penalized).toBeGreaterThan(0);
  });

  it('a weeksAgo value outside the recency window applies no penalty', () => {
    const outside = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: null }, [], {}, RECENCY_WINDOW_WEEKS + 1);
    expect(outside).toBe(1);
  });

  it('the most recent week is penalized more heavily than an older week within the window', () => {
    const lastWeek = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: null }, [], {}, 1);
    const threeWeeksAgo = scoreCandidate({ recipeId: 'r1', cuisineTier1: null, cuisineTier2: null }, [], {}, 3);
    expect(lastWeek).toBeLessThan(threeWeeksAgo);
  });
});

describe('pickForSlots', () => {
  const slot = (dayOfWeek: number, mealSlot: string, slotRole: string): EmptySlot => ({ dayOfWeek, mealSlot, slotRole });
  const candidate = (recipeId: string, weight = 1): WeightedCandidate => ({ recipeId, weight });

  it('picks a recipe for every slot when its role has candidates', () => {
    const slots = [slot(0, 'lunch', 'carb')];
    const candidatesByRole = new Map([['carb', [candidate('r1')]]]);
    const picks = pickForSlots(slots, candidatesByRole, () => 0.5);
    expect(picks).toEqual([{ dayOfWeek: 0, mealSlot: 'lunch', slotRole: 'carb', recipeId: 'r1' }]);
  });

  it('skips a slot whose role has no candidates at all, rather than throwing — best-effort partial, not all-or-nothing', () => {
    const slots = [slot(0, 'lunch', 'carb'), slot(0, 'lunch', 'sabzi_dal')];
    const candidatesByRole = new Map([['sabzi_dal', [candidate('r1')]]]); // no 'carb' entry
    const picks = pickForSlots(slots, candidatesByRole, () => 0.5);
    expect(picks).toHaveLength(1);
    expect(picks[0]?.slotRole).toBe('sabzi_dal');
  });

  it('never places the same recipe twice within a single meal instance, even across different roles', () => {
    const slots = [slot(0, 'lunch', 'carb'), slot(0, 'lunch', 'sabzi_dal')];
    // The same recipe id is (unusually, but validly) the only candidate for both roles.
    const candidatesByRole = new Map([
      ['carb', [candidate('shared-recipe')]],
      ['sabzi_dal', [candidate('shared-recipe')]],
    ]);
    const picks = pickForSlots(slots, candidatesByRole, () => 0.5);
    // Only the first slot gets filled; the second has no eligible candidate left.
    expect(picks).toHaveLength(1);
    expect(picks[0]?.recipeId).toBe('shared-recipe');
  });

  it('a different day\'s or different meal\'s identical slot is NOT excluded by an earlier pick — the no-repeat rule is meal-scoped, not week-scoped', () => {
    const slots = [slot(0, 'lunch', 'carb'), slot(0, 'dinner', 'carb'), slot(1, 'lunch', 'carb')];
    const candidatesByRole = new Map([['carb', [candidate('only-recipe')]]]);
    const picks = pickForSlots(slots, candidatesByRole, () => 0.5);
    expect(picks).toHaveLength(3);
    expect(picks.every((pick) => pick.recipeId === 'only-recipe')).toBe(true);
  });

  it('a \'less\'-weighted candidate is still picked when it is the only one available', () => {
    const slots = [slot(0, 'lunch', 'carb')];
    const candidatesByRole = new Map([['carb', [candidate('low-weight', 0.4)]]]);
    const picks = pickForSlots(slots, candidatesByRole, () => 0.99);
    expect(picks[0]?.recipeId).toBe('low-weight');
  });

  it('a floating-point-rounding remainder (0.1 + 0.2 !== 0.3 in IEEE754) still returns the last candidate, via the documented fallback branch, not undefined', () => {
    // total = 0.1 + 0.2 = 0.30000000000000004 (a well-known JS float quirk).
    // rng() = 1 makes `remaining` start at exactly `total`; subtracting each
    // weight in turn leaves a tiny positive residual after the last one
    // (0.30000000000000004 - 0.1 - 0.2 > 0), so the loop's `remaining <= 0`
    // check never fires and weightedPick falls through to its documented
    // last-candidate fallback rather than the normal in-loop return.
    const slots = [slot(0, 'lunch', 'carb')];
    const candidatesByRole = new Map([['carb', [candidate('first', 0.1), candidate('second', 0.2)]]]);
    const picks = pickForSlots(slots, candidatesByRole, () => 1);
    expect(picks[0]?.recipeId).toBe('second');
  });

  it('the same seed (a deterministic rng) produces the same picks every time', () => {
    const slots = [slot(0, 'lunch', 'carb'), slot(0, 'lunch', 'sabzi_dal')];
    const candidatesByRole = new Map([
      ['carb', [candidate('c1', 1), candidate('c2', 1)]],
      ['sabzi_dal', [candidate('s1', 1), candidate('s2', 1)]],
    ]);
    const makeSeededRng = (): (() => number) => {
      let seed = 42;
      return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
    };
    const first = pickForSlots(slots, candidatesByRole, makeSeededRng());
    const second = pickForSlots(slots, candidatesByRole, makeSeededRng());
    expect(first).toEqual(second);
  });

  it('a weighted pool favors the higher-weight candidate over many draws — the "random-ish" property is a real distribution, not a coin flip', () => {
    const slots = [slot(0, 'lunch', 'carb')];
    const candidatesByRole = new Map([['carb', [candidate('heavy', 9), candidate('light', 1)]]]);
    let heavyCount = 0;
    const trials = 200;
    // A seeded LCG, not live Math.random() — the whole point of the
    // injected-RNG design is a fully deterministic, reproducible test, not
    // one that is merely astronomically unlikely to flake.
    let seed = 1;
    const seededRng = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < trials; i += 1) {
      const picks = pickForSlots(slots, candidatesByRole, seededRng);
      if (picks[0]?.recipeId === 'heavy') {
        heavyCount += 1;
      }
    }
    // 9:1 weighting should land well north of a 50/50 split across 200 trials.
    expect(heavyCount).toBeGreaterThan(trials * 0.7);
  });
});
