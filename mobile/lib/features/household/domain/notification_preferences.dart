/// The app's own notification-preferences type, independent of GraphQL and of
/// `built_value` — same rule `household.dart` follows.
///
/// `fcmToken` has no field here because it has no field on the wire at all
/// (`shared/schema.graphql`'s `NotificationPreferences` type, W8 S8): it is a
/// device push credential, registered by a future W20 mutation, and no
/// client ever reads it back.
library;

/// The caller's own notification preferences for one household. Always the
/// caller's own row — there is no server operation that reads or writes a
/// fellow member's.
///
/// Every toggle carries honest copy in the screen (not here) that it takes
/// effect once push notifications ship (W20) — the values persist and round
/// -trip correctly today, but nothing sends a push yet.
class NotificationPreferences {
  const NotificationPreferences({
    required this.householdId,
    required this.listChanges,
    required this.mealReminder,
    required this.expiry,
    required this.activity,
  });

  final String householdId;
  final bool listChanges;
  final bool mealReminder;
  final bool expiry;
  final bool activity;

  /// A copy with one field flipped — used for the optimistic toggle-and-
  /// revert-on-error flow, so a screen never has to reconstruct the whole
  /// object field-by-field just to flip one boolean.
  NotificationPreferences copyWith({
    bool? listChanges,
    bool? mealReminder,
    bool? expiry,
    bool? activity,
  }) => NotificationPreferences(
    householdId: householdId,
    listChanges: listChanges ?? this.listChanges,
    mealReminder: mealReminder ?? this.mealReminder,
    expiry: expiry ?? this.expiry,
    activity: activity ?? this.activity,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is NotificationPreferences &&
          householdId == other.householdId &&
          listChanges == other.listChanges &&
          mealReminder == other.mealReminder &&
          expiry == other.expiry &&
          activity == other.activity;

  @override
  int get hashCode =>
      Object.hash(householdId, listChanges, mealReminder, expiry, activity);

  @override
  String toString() =>
      'NotificationPreferences(householdId: $householdId, listChanges: '
      '$listChanges, mealReminder: $mealReminder, expiry: $expiry, '
      'activity: $activity)';
}

/// One of the four independently-togglable fields — used by the controller
/// and the screen's table-driven toggle list so "which field does this row
/// control" is expressed once, not re-derived from a `String` label.
enum NotificationPreferenceField { listChanges, mealReminder, expiry, activity }

extension NotificationPreferencesFieldAccess on NotificationPreferences {
  /// Reads [field]'s current value — the other half of
  /// [NotificationPreferences.copyWith]'s table-driven write, so the screen's
  /// row list can both read and flip any field via the same enum.
  bool valueOf(NotificationPreferenceField field) => switch (field) {
    NotificationPreferenceField.listChanges => listChanges,
    NotificationPreferenceField.mealReminder => mealReminder,
    NotificationPreferenceField.expiry => expiry,
    NotificationPreferenceField.activity => activity,
  };

  /// Returns a copy with [field] set to [value] — the table-driven
  /// counterpart to [copyWith]'s named parameters.
  NotificationPreferences withField(
    NotificationPreferenceField field,
    bool value,
  ) => switch (field) {
    NotificationPreferenceField.listChanges => copyWith(listChanges: value),
    NotificationPreferenceField.mealReminder => copyWith(mealReminder: value),
    NotificationPreferenceField.expiry => copyWith(expiry: value),
    NotificationPreferenceField.activity => copyWith(activity: value),
  };
}
