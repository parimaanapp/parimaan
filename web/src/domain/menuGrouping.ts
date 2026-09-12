/**
 * W18 S4's day/meal-slot grouping for the dashboard's read-only "This
 * week's plan" section. Mirrors the two ordering rules
 * `mobile/lib/features/menu/presentation/weekly_plan_screen.dart` and
 * `mobile/lib/features/menu/domain/today.dart` already establish:
 *
 *  - `Menu.dayOfWeek: 0..6` is Monday..Sunday (`weekdayNames` in
 *    `weekly_plan_screen.dart`), not insertion order.
 *  - Within a day, meal slots render breakfast -> lunch -> snacks -> dinner
 *    (`_mealTypeOrder` in `today.dart`), a real day's own chronology, not
 *    `Menu.items`' own incoming order.
 *
 * Deliberately does NOT port `meal_slot_plan.dart`'s `plannedSlotsForDay` —
 * that function pads a day out with EMPTY, addable "+" slots per the
 * household's own `mealStructure` config, which only matters for an
 * editable grid. This dashboard is read-only (D5): there is no "+"
 * affordance to size a slot for, so only the FILLED items are grouped here.
 */

export interface MenuItemLike {
  dayOfWeek: number;
  mealSlot: string;
}

const MEAL_SLOT_ORDER = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;

export interface MealSlotGroup<T extends MenuItemLike> {
  mealSlot: string;
  items: T[];
}

export interface DayGroup<T extends MenuItemLike> {
  dayOfWeek: number;
  mealSlots: MealSlotGroup<T>[];
}

const mealSlotRank = (mealSlot: string): number => {
  const index = MEAL_SLOT_ORDER.indexOf(mealSlot as (typeof MEAL_SLOT_ORDER)[number]);
  // An unrecognised meal slot sorts after every known one rather than being
  // dropped — same "pass unrecognised values through" posture this
  // codebase's category-grouping helpers already use.
  return index === -1 ? MEAL_SLOT_ORDER.length : index;
};

/**
 * Groups `items` into day order (0..6, only days that actually have at
 * least one item), and within each day into meal-slot order. Never depends
 * on `items`' own incoming order — two calls with the same items in a
 * different order produce the same grouped output.
 */
export const groupMenuItemsByDayAndMealSlot = <T extends MenuItemLike>(items: T[]): DayGroup<T>[] => {
  const byDay = new Map<number, Map<string, T[]>>();
  for (const item of items) {
    const dayBucket = byDay.get(item.dayOfWeek) ?? new Map<string, T[]>();
    const mealSlotBucket = dayBucket.get(item.mealSlot) ?? [];
    mealSlotBucket.push(item);
    dayBucket.set(item.mealSlot, mealSlotBucket);
    byDay.set(item.dayOfWeek, dayBucket);
  }

  const orderedDays = [...byDay.keys()].sort((a, b) => a - b);

  return orderedDays.map((dayOfWeek) => {
    const dayBucket = byDay.get(dayOfWeek) as Map<string, T[]>;
    const orderedMealSlots = [...dayBucket.keys()].sort((a, b) => mealSlotRank(a) - mealSlotRank(b));
    return {
      dayOfWeek,
      mealSlots: orderedMealSlots.map((mealSlot) => ({
        mealSlot,
        items: dayBucket.get(mealSlot) as T[],
      })),
    };
  });
};

/** `Menu.dayOfWeek: 0..6` -> display name, matching `weekdayNames` in `weekly_plan_screen.dart`. */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const weekdayName = (dayOfWeek: number): string => WEEKDAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
