/// The seven weekday names for `Menu.dayOfWeek: 0..6` — `0` is Monday, per
/// this codebase's own migration/test precedent (`Menu.itemsForDay`'s own
/// doc, `domain/current_week.dart`'s `currentWeekStartDate`).
///
/// Public so the weekly plan, `auto_fill_preview_screen.dart` and
/// `day_overflow_menu.dart` all render the same seven names rather than
/// keeping copies that could drift. Re-exported from
/// `weekly_plan_screen.dart`, where it used to live.
const List<String> weekdayNames = <String>[
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
