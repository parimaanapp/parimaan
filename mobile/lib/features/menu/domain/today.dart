import 'package:collection/collection.dart' show mergeSort;

import 'menu.dart';

/// The order `TodayScreen` groups today's items in — breakfast → lunch →
/// snacks → dinner, matching a real day's own chronology, NOT insertion
/// order (the order `Menu.itemsForDay` itself returns, which is whatever
/// `menuRepository.ts`'s `findMenuItems` ordered by — day, meal slot,
/// placement TIME, so two items placed out of meal-time order would render
/// out of meal-time order if this list weren't re-sorted here).
const List<String> _mealTypeOrder = <String>[
  'breakfast',
  'lunch',
  'snacks',
  'dinner',
];

/// Every [MenuItem] planned for [today] (defaulting to the device's own
/// local calendar date, the same client-side-only computation
/// `current_week.dart`'s `currentWeekStartDate` uses — E2E_MVP_PLAN.md
/// §15.2.4/§15.2.5's locked decision: "today" is never server-computed),
/// grouped into meal-type order.
///
/// A pure function over [menu] — the SAME `Menu` the Weekly plan screen
/// already fetches via `CurrentMenuController`, not a second fetch or a
/// separate query, per §15.2.5's own "today's agenda reuses `Query.menu`"
/// decision.
List<MenuItem> todaysItems(Menu menu, {DateTime? today}) {
  final DateTime now = today ?? DateTime.now();
  final int dayOfWeek = now.weekday - 1; // DateTime.weekday: 1=Mon..7=Sun.
  final List<MenuItem> items = menu.itemsForDay(dayOfWeek);

  final List<MenuItem> sorted = List<MenuItem>.of(items);
  // `mergeSort`, not `List.sort` — the Dart SDK explicitly does NOT
  // guarantee `List.sort` is stable ("distinct objects that compare as
  // equal may occur in any order"), which would silently undo the
  // placement-time order `Menu.itemsForDay` already returns within a
  // single meal slot (a household can have up to 3 lunch/dinner items at
  // once — `domain/meal_slot_plan.dart`) — exactly the ordering this
  // function exists to preserve, per its own doc above. `mergeSort` is
  // guaranteed stable.
  mergeSort(
    sorted,
    compare: (MenuItem a, MenuItem b) {
      final int orderA = _mealTypeOrder.indexOf(a.mealSlot);
      final int orderB = _mealTypeOrder.indexOf(b.mealSlot);
      // An unrecognised mealSlot (a value this build predates) sorts last
      // rather than throwing or crashing the comparator — `indexOf`
      // returns -1 for it, so this bumps it past every real value with an
      // explicit tiebreak instead of relying on -1's own (accidentally
      // correct, but not the point) sort-first behavior.
      final int safeA = orderA == -1 ? _mealTypeOrder.length : orderA;
      final int safeB = orderB == -1 ? _mealTypeOrder.length : orderB;
      return safeA.compareTo(safeB);
    },
  );
  return sorted;
}
