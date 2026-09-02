/// UTC midnight of [date]'s own calendar-date components (year/month/day),
/// discarding [date]'s own time-of-day and timezone. The one canonical
/// normalizer for "a calendar date, represented as the UTC-midnight
/// `DateTime` this codebase's `Menu`/`MenuKey` machinery expects" — reused by
/// [currentWeekStartDate] below and by `state/current_menu_controller.dart`'s
/// `menuKeyFor` (see that function's own doc for why this normalization
/// matters: `DateTime.==` considers `isUtc` and microseconds, not just the
/// calendar date, so two un-normalized `DateTime`s meaning the same week
/// would otherwise compare unequal).
DateTime utcMidnight(DateTime date) =>
    DateTime.utc(date.year, date.month, date.day);

/// The Monday (`Menu.weekStartDate`, `dayOfWeek: 0`) of the week containing
/// [today] — computed client-side, from the DEVICE's own local calendar
/// date, never server-computed (E2E_MVP_PLAN.md §15.2.4's locked decision:
/// "today"/week boundaries are calendar dates, deliberately not
/// timezone-attached, and there is no household-level timezone column to
/// compute them against server-side even if this codebase wanted to).
///
/// [today] defaults to [DateTime.now()] — a parameter (not a hardcoded call
/// inside the body) purely so a test can pass a fixed date instead of racing
/// the real clock.
DateTime currentWeekStartDate({DateTime? today}) {
  final DateTime now = today ?? DateTime.now();
  // `Menu.dayOfWeek: 0` is the week's first day (see `Menu.itemsForDay`'s own
  // doc) — this codebase's own migration/test precedent treats that as
  // Monday (E2E_MVP_PLAN.md's own worked S1/S2 examples all place a Monday
  // at day 0). `DateTime.weekday` is already 1 (Monday) through 7 (Sunday),
  // so subtracting `weekday - 1` days lands on that same Monday.
  final DateTime monday = now.subtract(Duration(days: now.weekday - 1));
  return utcMidnight(monday);
}
