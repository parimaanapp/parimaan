import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/menu/domain/current_week.dart';

void main() {
  group('utcMidnight', () {
    test(
      'discards time-of-day and timezone, keeping only the calendar date',
      () {
        expect(
          utcMidnight(DateTime(2026, 9, 9, 23, 59, 59)),
          DateTime.utc(2026, 9, 9),
        );
        expect(
          utcMidnight(DateTime.utc(2026, 9, 9, 13, 45)),
          DateTime.utc(2026, 9, 9),
        );
      },
    );
  });

  group('currentWeekStartDate', () {
    // Table-driven across all 7 possible "today" values — the same
    // transposition-class rigor E2E_MVP_PLAN.md §15.3 S5/S6's own RED specs
    // require for day-of-week calculations, not one day sampled and assumed
    // representative.
    final Map<DateTime, DateTime> mondayForEachWeekday = <DateTime, DateTime>{
      DateTime(2026, 9, 7): DateTime.utc(2026, 9, 7), // Monday
      DateTime(2026, 9, 8): DateTime.utc(2026, 9, 7), // Tuesday
      DateTime(2026, 9, 9): DateTime.utc(2026, 9, 7), // Wednesday
      DateTime(2026, 9, 10): DateTime.utc(2026, 9, 7), // Thursday
      DateTime(2026, 9, 11): DateTime.utc(2026, 9, 7), // Friday
      DateTime(2026, 9, 12): DateTime.utc(2026, 9, 7), // Saturday
      DateTime(2026, 9, 13): DateTime.utc(2026, 9, 7), // Sunday
    };

    for (final MapEntry<DateTime, DateTime> entry
        in mondayForEachWeekday.entries) {
      test(
        'for ${entry.key} (weekday ${entry.key.weekday}) returns the Monday ${entry.value}',
        () {
          expect(currentWeekStartDate(today: entry.key), entry.value);
        },
      );
    }

    test('the following Monday starts a new week', () {
      expect(
        currentWeekStartDate(today: DateTime(2026, 9, 14)),
        DateTime.utc(2026, 9, 14),
      );
    });
  });
}
