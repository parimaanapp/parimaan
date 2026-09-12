import { groupMenuItemsByDayAndMealSlot, weekdayName } from '@/domain/menuGrouping';
import type { MenuQueryResult } from '@/graphql/queries';

interface MenuSectionProps {
  menu: MenuQueryResult['menu'];
}

/**
 * D5's read-only "This week's plan" section — `Query.menu`'s items grouped
 * by day then meal slot (`domain/menuGrouping.ts`'s own Monday-first,
 * breakfast-first order, mirroring `weekly_plan_screen.dart`/`today.dart`).
 * Entirely read-only: no "+" affordance for an empty slot, no edit action —
 * D5's own locked scope ("no meal-plan calendar editing on web MVP"). Its
 * own independent empty state (RED test 3) fires when `menu` is `null`
 * (no menu created yet for this week), never collapsed with the pantry or
 * shopping-list sections' own empty states.
 */
export function MenuSection({ menu }: MenuSectionProps) {
  if (menu === null) {
    return (
      <section aria-labelledby="menu-heading">
        <h2 id="menu-heading">This week&apos;s plan</h2>
        <p data-testid="menu-empty-state">No plan for this week yet.</p>
      </section>
    );
  }

  if (menu.items.length === 0) {
    return (
      <section aria-labelledby="menu-heading">
        <h2 id="menu-heading">This week&apos;s plan</h2>
        <p data-testid="menu-empty-state">No plan for this week yet.</p>
      </section>
    );
  }

  const days = groupMenuItemsByDayAndMealSlot(menu.items);

  return (
    <section aria-labelledby="menu-heading">
      <h2 id="menu-heading">This week&apos;s plan</h2>
      {days.map((day) => (
        <div key={day.dayOfWeek} data-testid={`menu-day-${day.dayOfWeek}`}>
          <h3>{weekdayName(day.dayOfWeek)}</h3>
          {day.mealSlots.map((slot) => (
            <div key={slot.mealSlot}>
              <h4>{slot.mealSlot}</h4>
              <ul>
                {slot.items.map((item) => (
                  <li key={item.id}>{item.recipe.title}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
