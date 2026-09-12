/**
 * W18 S4's TypeScript mirror of `mobile/lib/features/menu/domain/
 * current_week.dart`'s `currentWeekStartDate`/`utcMidnight` — the dashboard
 * must compute "this week" via the identical rule mobile already uses
 * (E2E_MVP_PLAN.md §24's own "mirror the existing convention, don't invent a
 * second date-math rule"), not a new interpretation. `Menu.dayOfWeek: 0` is
 * Monday (confirmed against `weekdayNames`/`_DaySection` in
 * `weekly_plan_screen.dart`), and "today" is computed client-side from the
 * caller's own local calendar date, never server-computed
 * (E2E_MVP_PLAN.md §15.2.4's locked decision) — on the web, "client-side"
 * means the Node server process rendering the page, which is this function's
 * own `today` parameter, defaulting to `new Date()`.
 */

/** UTC midnight of `date`'s own calendar-date components, discarding its time-of-day and timezone. */
export const utcMidnight = (date: Date): Date =>
  new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

/**
 * The Monday (`Menu.weekStartDate`, `dayOfWeek: 0`) of the week containing
 * `today`. `Date.getDay()` is 0 (Sunday) through 6 (Saturday) — converted to
 * the 1 (Monday) through 7 (Sunday) convention `current_week.dart`'s own
 * `DateTime.weekday` uses before applying the identical `weekday - 1` days
 * subtraction.
 */
export const currentWeekStartDate = (today: Date = new Date()): Date => {
  const isoWeekday = today.getDay() === 0 ? 7 : today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (isoWeekday - 1));
  return utcMidnight(monday);
};

/**
 * `currentWeekStartDate` as the `AWSDateTime` string `Query.menu`'s
 * `weekStartDate` argument expects (UTC midnight, ISO-8601).
 */
export const currentWeekStartDateIso = (today: Date = new Date()): string =>
  currentWeekStartDate(today).toISOString();
