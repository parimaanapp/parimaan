import 'package:mobile/features/household/data/notification_preferences_repository.dart';
import 'package:mobile/features/household/domain/notification_preferences.dart';

/// Hand-written [NotificationPreferencesRepository] double — same rationale
/// as `FakeHouseholdRepository`'s own doc: explicit control over when a
/// `Future` completes and which outcome it carries, without a mocking
/// framework.
class FakeNotificationPreferencesRepository
    implements NotificationPreferencesRepository {
  FakeNotificationPreferencesRepository({
    this.fetchResult,
    this.fetchError,
    this.updateResult,
    this.updateError,
    this.delay,
  });

  NotificationPreferences? fetchResult;
  Object? fetchError;

  /// Falls back to whatever the fake would return after applying the patch
  /// to [fetchResult] — see [updatePreference]. Set explicitly when a test
  /// wants the "server disagrees with the optimistic value" case.
  NotificationPreferences? updateResult;
  Object? updateError;

  Duration? delay;

  final List<String> fetchCalls = <String>[];
  final List<
    ({String householdId, NotificationPreferenceField field, bool value})
  >
  updateCalls =
      <({String householdId, NotificationPreferenceField field, bool value})>[];

  Future<void> _wait() async {
    final Duration? d = delay;
    if (d != null) {
      await Future<void>.delayed(d);
    }
  }

  @override
  Future<NotificationPreferences> fetchPreferences(String householdId) async {
    fetchCalls.add(householdId);
    await _wait();
    if (fetchError != null) {
      throw fetchError!;
    }
    final NotificationPreferences? result = fetchResult;
    if (result == null) {
      throw StateError(
        'FakeNotificationPreferencesRepository needs a fetchResult or fetchError.',
      );
    }
    return result;
  }

  @override
  Future<NotificationPreferences> updatePreference(
    String householdId,
    NotificationPreferenceField field,
    bool value,
  ) async {
    updateCalls.add((householdId: householdId, field: field, value: value));
    await _wait();
    if (updateError != null) {
      throw updateError!;
    }
    final NotificationPreferences? explicit = updateResult;
    if (explicit != null) {
      return explicit;
    }
    final NotificationPreferences? base = fetchResult;
    if (base == null) {
      throw StateError(
        'FakeNotificationPreferencesRepository needs an updateResult, an '
        'updateError, or a fetchResult to derive one from.',
      );
    }
    return base.withField(field, value);
  }
}
