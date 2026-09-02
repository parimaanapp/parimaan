import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/notification_preferences_repository.dart';
import '../domain/notification_preferences.dart';

/// The server-backed read of the CALLER's own notification preferences for
/// one household, keyed by householdId — same family-per-household shape as
/// `CurrentHouseholdController`, and for the same reason: a user in two
/// households needs each household's preferences cached independently.
class NotificationPreferencesController
    extends FamilyAsyncNotifier<NotificationPreferences, String> {
  NotificationPreferencesRepository get _repository =>
      ref.read(notificationPreferencesRepositoryProvider);

  @override
  Future<NotificationPreferences> build(String householdId) =>
      _repository.fetchPreferences(householdId);

  /// Flips [field] optimistically, then confirms with the server.
  ///
  /// The screen sees the new value the instant it is tapped — a network
  /// round trip before a toggle visibly moves reads as broken, not careful.
  /// If the server call fails, [state] reverts to the PRE-toggle value (not
  /// the optimistic one), and `state.error` carries the failure so the
  /// screen can surface it. A toggle that stays visually flipped after the
  /// server rejected it would silently disagree with what is actually
  /// saved — worse than a toggle that visibly snaps back with an
  /// explanation. See the revert branch below for why this needs two
  /// assignments, not `AsyncError.copyWithPrevious` with a captured
  /// snapshot.
  ///
  /// A no-op if nothing has loaded yet — the screen does not render any
  /// toggle before [state] has a value, so a tap cannot reach this with a
  /// null value in practice; this makes that precondition explicit instead
  /// of a null-check surfacing deeper in.
  Future<void> toggle(NotificationPreferenceField field) async {
    final NotificationPreferences? current = state.valueOrNull;
    if (current == null) {
      return;
    }

    final bool newValue = !current.valueOf(field);
    state = AsyncData<NotificationPreferences>(
      current.withField(field, newValue),
    );

    final AsyncValue<NotificationPreferences> result =
        await AsyncValue.guard<NotificationPreferences>(
          () => _repository.updatePreference(
            current.householdId,
            field,
            newValue,
          ),
        );

    if (result.hasError) {
      // `AsyncNotifier`'s `state` setter routes an `AsyncError` through
      // Riverpod's own `asyncTransition`, which unconditionally fills a
      // fresh `AsyncError`'s `value` from whatever `state` holds AT THE
      // MOMENT OF ASSIGNMENT (see `AsyncError.copyWithPrevious` in
      // `package:riverpod`) — NOT from a `previous` snapshot captured
      // earlier in this method. Calling `result.copyWithPrevious(previous)`
      // directly is therefore pointless: the framework immediately
      // re-wraps whatever is assigned to `state` using its own live
      // "previous" (at that point still the optimistic value), silently
      // discarding this method's own `previous` variable and leaving the
      // optimistic value in place instead of reverting it.
      //
      // The fix is two assignments, not one: first revert `state` to the
      // pre-toggle value as plain `AsyncData` (a no-op for `copyWithPrevious`,
      // so it lands exactly as given), THEN assign the raw error — at that
      // second assignment, the framework's own "live previous" is the
      // value this method just reverted to, so its automatic
      // `copyWithPrevious` correctly carries the reverted value forward
      // instead of the optimistic one.
      //
      // The revert target is `state.valueOrNull`'s CURRENT live value with
      // just [field] flipped back — not the `current` snapshot captured at
      // the top of this method. Two toggles on different fields can race
      // (tap field A, then field B before A's round trip settles); if A's
      // call fails, reverting to A's own pre-toggle snapshot would silently
      // discard B's already-applied optimistic (or by-then confirmed)
      // change too. Un-flipping only this field, against whatever is live
      // right now, means an error on A only ever undoes A's own flip.
      final NotificationPreferences base = state.valueOrNull ?? current;
      state = AsyncData<NotificationPreferences>(
        base.withField(field, !newValue),
      );
      state = result;
    } else {
      state = result;
    }
  }
}

final AsyncNotifierProviderFamily<
  NotificationPreferencesController,
  NotificationPreferences,
  String
>
notificationPreferencesControllerProvider =
    AsyncNotifierProvider.family<
      NotificationPreferencesController,
      NotificationPreferences,
      String
    >(NotificationPreferencesController.new);
