import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/notification_preferences_repository.dart';
import 'package:mobile/features/household/domain/notification_preferences.dart';
import 'package:mobile/features/household/state/notification_preferences_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_notification_preferences_repository.dart';

ProviderContainer _container(NotificationPreferencesRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      notificationPreferencesRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

/// A double whose call for [pendingFor] doesn't resolve until [pending]
/// does — every other field resolves immediately against [initial] patched
/// with the requested value. Lets a test control which of two concurrent
/// `toggle()` calls settles first, which `FakeNotificationPreferencesRepository`'s
/// single shared `delay` can't express.
class _OrderedFakeRepository implements NotificationPreferencesRepository {
  _OrderedFakeRepository({
    required this.initial,
    required this.pendingFor,
    required this.pending,
  });

  final NotificationPreferences initial;
  final NotificationPreferenceField pendingFor;
  final Future<NotificationPreferences> pending;

  @override
  Future<NotificationPreferences> fetchPreferences(String householdId) async =>
      initial;

  @override
  Future<NotificationPreferences> updatePreference(
    String householdId,
    NotificationPreferenceField field,
    bool value,
  ) {
    if (field == pendingFor) {
      return pending;
    }
    return Future<NotificationPreferences>.value(
      initial.withField(field, value),
    );
  }
}

const NotificationPreferences _allTrue = NotificationPreferences(
  householdId: 'household-1',
  listChanges: true,
  mealReminder: true,
  expiry: true,
  activity: true,
);

void main() {
  group('NotificationPreferencesController — build', () {
    test('fetches the household it is keyed on', () async {
      final FakeNotificationPreferencesRepository repository =
          FakeNotificationPreferencesRepository(fetchResult: _allTrue);
      final ProviderContainer container = _container(repository);

      final NotificationPreferences result = await container.read(
        notificationPreferencesControllerProvider('household-1').future,
      );

      expect(result, _allTrue);
      expect(repository.fetchCalls, <String>['household-1']);
    });

    test('a fetch failure lands in state with its concrete subtype', () async {
      final FakeNotificationPreferencesRepository repository =
          FakeNotificationPreferencesRepository(
            fetchError: const ForbiddenError('Not a member.'),
          );
      final ProviderContainer container = _container(repository);

      await expectLater(
        container.read(
          notificationPreferencesControllerProvider('household-1').future,
        ),
        throwsA(isA<ForbiddenError>()),
      );
    });
  });

  group('NotificationPreferencesController — toggle', () {
    test(
      'flips the tapped field optimistically before the server responds',
      () async {
        final FakeNotificationPreferencesRepository repository =
            FakeNotificationPreferencesRepository(
              fetchResult: _allTrue,
              delay: const Duration(milliseconds: 20),
            );
        final ProviderContainer container = _container(repository);
        await container.read(
          notificationPreferencesControllerProvider('household-1').future,
        );

        final Future<void> pending = container
            .read(
              notificationPreferencesControllerProvider('household-1').notifier,
            )
            .toggle(NotificationPreferenceField.listChanges);

        // Before the fake's delayed response ever resolves, the flip is
        // already visible — this is what "optimistic" means, and a test with
        // no delay could never distinguish it from "flips after the round
        // trip completes".
        expect(
          container
              .read(notificationPreferencesControllerProvider('household-1'))
              .value!
              .listChanges,
          isFalse,
        );

        await pending;
      },
    );

    test(
      'the four toggles map to the four fields with no transposition',
      () async {
        for (final NotificationPreferenceField field
            in NotificationPreferenceField.values) {
          final FakeNotificationPreferencesRepository repository =
              FakeNotificationPreferencesRepository(fetchResult: _allTrue);
          final ProviderContainer container = _container(repository);
          await container.read(
            notificationPreferencesControllerProvider('household-1').future,
          );

          await container
              .read(
                notificationPreferencesControllerProvider('household-1')
                    .notifier,
              )
              .toggle(field);

          final NotificationPreferences result = container
              .read(notificationPreferencesControllerProvider('household-1'))
              .value!;

          for (final NotificationPreferenceField other
              in NotificationPreferenceField.values) {
            expect(
              result.valueOf(other),
              other == field ? isFalse : isTrue,
              reason: 'toggling $field must flip only $field, not $other',
            );
          }
        }
      },
    );

    test(
      'confirms with the server-returned value once the round trip settles',
      () async {
        final FakeNotificationPreferencesRepository repository =
            FakeNotificationPreferencesRepository(
              fetchResult: _allTrue,
              updateResult: const NotificationPreferences(
                householdId: 'household-1',
                listChanges: false,
                mealReminder: true,
                expiry: true,
                activity: true,
              ),
            );
        final ProviderContainer container = _container(repository);
        await container.read(
          notificationPreferencesControllerProvider('household-1').future,
        );

        await container
            .read(
              notificationPreferencesControllerProvider('household-1').notifier,
            )
            .toggle(NotificationPreferenceField.listChanges);

        expect(
          container
              .read(notificationPreferencesControllerProvider('household-1'))
              .value!
              .listChanges,
          isFalse,
        );
        expect(repository.updateCalls.single, (
          householdId: 'household-1',
          field: NotificationPreferenceField.listChanges,
          value: false,
        ));
      },
    );

    test('reverts to the pre-toggle value and surfaces the error on a server failure', () async {
      final FakeNotificationPreferencesRepository repository =
          FakeNotificationPreferencesRepository(
            fetchResult: _allTrue,
            updateError: const InternalError('network down'),
          );
      final ProviderContainer container = _container(repository);
      await container.read(
        notificationPreferencesControllerProvider('household-1').future,
      );

      await container
          .read(
            notificationPreferencesControllerProvider('household-1').notifier,
          )
          .toggle(NotificationPreferenceField.listChanges);

      final AsyncValue<NotificationPreferences> state = container.read(
        notificationPreferencesControllerProvider('household-1'),
      );
      expect(state.hasError, isTrue);
      expect(
        state.value?.listChanges,
        isTrue,
        reason: 'reverted to the pre-toggle value, not left flipped',
      );
    });

    test(
      "a failed toggle only reverts its OWN field — a concurrent toggle on "
      'a different field, still in flight or already confirmed, survives',
      () async {
        // A field's own request is held open via a `Completer` so the test
        // can toggle a SECOND field and let IT resolve first, before this
        // one is failed — `FakeNotificationPreferencesRepository`'s single
        // shared `delay` can't express "these two calls settle in a
        // specific order", so this is a small ad hoc double instead.
        final Completer<NotificationPreferences> listChangesCompleter =
            Completer<NotificationPreferences>();
        final _OrderedFakeRepository repository = _OrderedFakeRepository(
          initial: _allTrue,
          pendingFor: NotificationPreferenceField.listChanges,
          pending: listChangesCompleter.future,
        );
        final ProviderContainer container = _container(repository);
        await container.read(
          notificationPreferencesControllerProvider('household-1').future,
        );
        final NotificationPreferencesController controller = container.read(
          notificationPreferencesControllerProvider('household-1').notifier,
        );

        final Future<void> listChangesToggle = controller.toggle(
          NotificationPreferenceField.listChanges,
        );
        // `listChanges`'s own network call is still pending (the completer
        // above is unresolved) — flip `activity` now, which resolves
        // immediately and confirms before `listChanges` ever settles.
        await controller.toggle(NotificationPreferenceField.activity);
        expect(
          container
              .read(notificationPreferencesControllerProvider('household-1'))
              .value
              ?.activity,
          isFalse,
          reason: 'activity is already confirmed by the server at this point',
        );

        listChangesCompleter.completeError(const InternalError('network down'));
        await listChangesToggle;

        final NotificationPreferences result = container
            .read(notificationPreferencesControllerProvider('household-1'))
            .value!;
        expect(
          result.listChanges,
          isTrue,
          reason: 'listChanges reverted — its own toggle failed',
        );
        expect(
          result.activity,
          isFalse,
          reason:
              "activity's own successful toggle must survive listChanges' "
              'unrelated failure',
        );
      },
    );

    test('a toggle before anything has loaded is a harmless no-op', () async {
      final FakeNotificationPreferencesRepository repository =
          FakeNotificationPreferencesRepository(
            delay: const Duration(milliseconds: 20),
            fetchResult: _allTrue,
          );
      final ProviderContainer container = _container(repository);
      // Deliberately not awaited — state is still `AsyncLoading` here.
      final Future<NotificationPreferences> pending = container.read(
        notificationPreferencesControllerProvider('household-1').future,
      );

      await expectLater(
        container
            .read(
              notificationPreferencesControllerProvider('household-1').notifier,
            )
            .toggle(NotificationPreferenceField.activity),
        completes,
      );
      expect(repository.updateCalls, isEmpty);

      await pending;
    });
  });
}
