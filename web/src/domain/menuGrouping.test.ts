import { describe, expect, it } from 'vitest';
import { groupMenuItemsByDayAndMealSlot, weekdayName } from './menuGrouping';

describe('weekdayName', () => {
  it('maps dayOfWeek 0 to Monday, matching Menu.dayOfWeek convention', () => {
    expect(weekdayName(0)).toBe('Monday');
    expect(weekdayName(6)).toBe('Sunday');
  });
});

describe('groupMenuItemsByDayAndMealSlot', () => {
  it('orders days Monday-first and meal slots breakfast -> lunch -> snacks -> dinner', () => {
    const items = [
      { id: 'a', dayOfWeek: 2, mealSlot: 'dinner' },
      { id: 'b', dayOfWeek: 0, mealSlot: 'dinner' },
      { id: 'c', dayOfWeek: 0, mealSlot: 'breakfast' },
      { id: 'd', dayOfWeek: 0, mealSlot: 'lunch' },
    ];

    const days = groupMenuItemsByDayAndMealSlot(items);

    expect(days.map((d) => d.dayOfWeek)).toEqual([0, 2]);
    expect(days[0]?.mealSlots.map((s) => s.mealSlot)).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('is stable regardless of input order', () => {
    const itemDinner = { id: 'a', dayOfWeek: 1, mealSlot: 'dinner' };
    const itemLunch = { id: 'b', dayOfWeek: 0, mealSlot: 'lunch' };

    expect(groupMenuItemsByDayAndMealSlot([itemDinner, itemLunch])).toEqual(
      groupMenuItemsByDayAndMealSlot([itemLunch, itemDinner]),
    );
  });

  it('returns an empty array for no items', () => {
    expect(groupMenuItemsByDayAndMealSlot([])).toEqual([]);
  });
});
