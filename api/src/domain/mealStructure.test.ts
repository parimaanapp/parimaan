import { describe, expect, it } from 'vitest';
import { slotCountKeyRole } from './mealStructure.js';

describe('slotCountKeyRole', () => {
  it.each(['breakfast', 'snacks'])('collapses %s (a single-item slot) to null, regardless of slotRole', (mealSlot) => {
    expect(slotCountKeyRole(mealSlot, 'sabzi_dal')).toBeNull();
    expect(slotCountKeyRole(mealSlot, 'breakfast')).toBeNull();
  });

  it.each(['lunch', 'dinner'])('returns slotRole itself for %s (a per-role slot)', (mealSlot) => {
    expect(slotCountKeyRole(mealSlot, 'carb')).toBe('carb');
    expect(slotCountKeyRole(mealSlot, 'sabzi_dal')).toBe('sabzi_dal');
  });
});
