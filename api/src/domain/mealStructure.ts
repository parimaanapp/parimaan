/**
 * `household_settings.meal_structure` (AWSJSON) only ever carries per-role
 * caps for `lunch`/`dinner` (`MealStructure`, `householdDefaults.ts`) —
 * `breakfast`/`snacks` are single-recipe meals with no per-role structure at
 * all (E2E_MVP_PLAN.md §15.3 S3), so their cap is a flat 1 regardless of
 * `slotRole`, never read from `meal_structure`.
 */
export const SINGLE_ITEM_MEAL_SLOTS: readonly string[] = ['breakfast', 'snacks'];

export const isMealSlotEnabled = (mealsEnabled: readonly string[], mealSlot: string): boolean =>
  mealsEnabled.includes(mealSlot);

/**
 * The max number of `menu_items` `addMenuItem` should allow for one
 * `(dayOfWeek, mealSlot, slotRole)` triple, read from the household's own
 * `mealStructure`. Defensive against a malformed/missing entry (this is
 * `AWSJSON` — no DB-level shape guarantee beyond "valid JSON") — a missing
 * or non-numeric role entry caps at 0 rather than throwing or falling back
 * to "unlimited", since silently allowing an unconfigured slot to fill up
 * unbounded is the more dangerous failure mode of the two.
 */
export const getMealSlotCap = (
  mealStructure: Record<string, unknown>,
  mealSlot: string,
  slotRole: string,
): number => {
  if (SINGLE_ITEM_MEAL_SLOTS.includes(mealSlot)) {
    return 1;
  }
  const slotEntry = mealStructure[mealSlot];
  if (typeof slotEntry !== 'object' || slotEntry === null) {
    return 0;
  }
  const roleCap = (slotEntry as Record<string, unknown>)[slotRole];
  return typeof roleCap === 'number' && Number.isFinite(roleCap) && roleCap >= 0 ? roleCap : 0;
};
