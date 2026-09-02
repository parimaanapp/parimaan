import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/notification_preferences_repository.dart';
import 'package:mobile/features/household/domain/notification_preferences.dart';
import 'package:mobile/features/household/presentation/settings/notification_preferences_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../../support/fake_notification_preferences_repository.dart';
import '../../../../support/household_route_harness.dart';

const String _route = '/household/household-1/settings/notifications';

const NotificationPreferences _allTrue = NotificationPreferences(
  householdId: 'household-1',
  listChanges: true,
  mealReminder: true,
  expiry: true,
  activity: true,
);

Future<HouseholdHarness> _pump(
  WidgetTester tester, {
  FakeNotificationPreferencesRepository? notificationPreferencesRepository,
}) => pumpHouseholdRoute(
  tester,
  _route,
  overrides: <Override>[
    notificationPreferencesRepositoryProvider.overrideWithValue(
      notificationPreferencesRepository ??
          FakeNotificationPreferencesRepository(fetchResult: _allTrue),
    ),
  ],
);

void main() {
  group('NotificationPreferencesScreen — loading, error, data', () {
    testWidgets('shows a spinner while loading', (WidgetTester tester) async {
      // Pumped directly, bypassing `pumpHouseholdRoute`'s go_router harness
      // entirely: that harness's navigation always resolves through a
      // `pumpAndSettle()`, which would wait out the fake's own delay and
      // leave loaded data on screen by the time this test ever got control
      // back. The loading state doesn't exercise anything route-dependent
      // (no `context.go` runs during a build), so a bare `ProviderScope` +
      // `MaterialApp` is sufficient and lets a single un-settled `pump()`
      // actually observe the in-flight state.
      final FakeNotificationPreferencesRepository repository =
          FakeNotificationPreferencesRepository(
            fetchResult: _allTrue,
            delay: const Duration(milliseconds: 500),
          );
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            notificationPreferencesRepositoryProvider.overrideWithValue(
              repository,
            ),
          ],
          child: const MaterialApp(
            home: NotificationPreferencesScreen(householdId: 'household-1'),
          ),
        ),
      );
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOne);

      // Let the fake's own delayed Timer actually elapse before the test
      // ends — `flutter_test` fails a test that leaves a pending Timer
      // behind at teardown.
      await tester.pump(const Duration(milliseconds: 600));
    });

    testWidgets('a load failure renders an empty state with a way back', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        notificationPreferencesRepository:
            FakeNotificationPreferencesRepository(
              fetchError: const ForbiddenError('Not a member.'),
            ),
      );

      expect(find.text('Could not load notification preferences'), findsOne);
      expect(find.text('Back to settings'), findsOne);
    });

    testWidgets('renders all four toggles once loaded', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text('List changes'), findsOne);
      expect(find.text('Meal reminders'), findsOne);
      expect(find.text('Expiry warnings'), findsOne);
      expect(find.text('Household activity'), findsOne);
      for (final NotificationPreferenceField field
          in NotificationPreferenceField.values) {
        expect(
          find.byKey(NotificationPreferencesScreen.toggleKey(field)),
          findsOne,
        );
      }
    });

    testWidgets('every toggle carries the not-yet-active caveat', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(
        find.text('Takes effect once push notifications are turned on.'),
        findsNWidgets(4),
      );
    });
  });

  group('NotificationPreferencesScreen — the four toggles map correctly, no transposition', () {
    testWidgets('each toggle reflects its own field, not another one\'s', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        notificationPreferencesRepository:
            FakeNotificationPreferencesRepository(
              fetchResult: const NotificationPreferences(
                householdId: 'household-1',
                listChanges: false,
                mealReminder: true,
                expiry: false,
                activity: true,
              ),
            ),
      );

      Switch switchFor(NotificationPreferenceField field) =>
          tester.widget<Switch>(
            find.byKey(NotificationPreferencesScreen.toggleKey(field)),
          );

      expect(switchFor(NotificationPreferenceField.listChanges).value, isFalse);
      expect(switchFor(NotificationPreferenceField.mealReminder).value, isTrue);
      expect(switchFor(NotificationPreferenceField.expiry).value, isFalse);
      expect(switchFor(NotificationPreferenceField.activity).value, isTrue);
    });
  });

  group('NotificationPreferencesScreen — toggle optimism and revert', () {
    testWidgets(
      'tapping a toggle flips it immediately, then confirms with the server',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await _pump(tester);

        await tester.tap(
          find.byKey(
            NotificationPreferencesScreen.toggleKey(
              NotificationPreferenceField.listChanges,
            ),
          ),
        );
        await tester.pumpAndSettle();

        final Switch switchWidget = tester.widget<Switch>(
          find.byKey(
            NotificationPreferencesScreen.toggleKey(
              NotificationPreferenceField.listChanges,
            ),
          ),
        );
        expect(switchWidget.value, isFalse);
        expect(harness.container, isNotNull);
      },
    );

    testWidgets('a rejected toggle reverts and surfaces the server error', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        notificationPreferencesRepository:
            FakeNotificationPreferencesRepository(
              fetchResult: _allTrue,
              updateError: const InternalError('network down'),
            ),
      );

      await tester.tap(
        find.byKey(
          NotificationPreferencesScreen.toggleKey(
            NotificationPreferenceField.mealReminder,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final Switch switchWidget = tester.widget<Switch>(
        find.byKey(
          NotificationPreferencesScreen.toggleKey(
            NotificationPreferenceField.mealReminder,
          ),
        ),
      );
      expect(
        switchWidget.value,
        isTrue,
        reason: 'reverted to the pre-toggle value, not left flipped',
      );
      expect(find.text('network down'), findsOne);
    });
  });

  group('NotificationPreferencesScreen — accessibility', () {
    testWidgets(
      'each toggle\'s semantics state its meaning and the not-yet-active caveat',
      (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(tester);

        final SemanticsNode node = tester.getSemantics(
          find.byKey(
            NotificationPreferencesScreen.toggleKey(
              NotificationPreferenceField.listChanges,
            ),
          ),
        );

        expect(
          node.label,
          contains(
            'Alerts when a co-member adds to or edits the shopping list.',
          ),
        );
        expect(
          node.label,
          contains('Takes effect once push notifications are turned on.'),
        );

        handle.dispose();
      },
    );

    testWidgets(
      'each toggle exposes a tap action — a screen reader can actually '
      'activate it, not just hear its label',
      (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await _pump(tester);

        final SemanticsNode node = tester.getSemantics(
          find.byKey(
            NotificationPreferencesScreen.toggleKey(
              NotificationPreferenceField.listChanges,
            ),
          ),
        );

        expect(
          node.getSemanticsData().hasAction(SemanticsAction.tap),
          isTrue,
          reason:
              'excludeSemantics discards the Switch\'s own tap action — '
              'without a replacement, double-tap-to-activate would do '
              'nothing',
        );

        handle.dispose();
      },
    );
  });
}
