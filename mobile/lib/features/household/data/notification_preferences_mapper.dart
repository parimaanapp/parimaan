import '../../../shared/graphql/operations/__generated__/notification_preferences_fields.data.gql.dart';
import '../domain/notification_preferences.dart';

/// The boundary where Ferry / `built_value` types become the plain
/// [NotificationPreferences] domain type — same rule `household_mapper.dart`
/// follows.
///
/// The parameter type is the fragment interface
/// `GNotificationPreferencesFields`, not either operation's own data class:
/// both `Query.notificationPreferences` and
/// `Mutation.updateNotificationPreferences` spread
/// `...NotificationPreferencesFields`, and ferry makes both generated data
/// classes `implements GNotificationPreferencesFields` — so this one function
/// maps both.
NotificationPreferences notificationPreferencesFromGraphQL(
  GNotificationPreferencesFields fields,
) => NotificationPreferences(
  householdId: fields.householdId,
  listChanges: fields.listChanges,
  mealReminder: fields.mealReminder,
  expiry: fields.expiry,
  activity: fields.activity,
);
