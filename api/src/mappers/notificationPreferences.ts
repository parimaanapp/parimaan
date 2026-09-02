import type { NotificationPreferencesRow } from '../repositories/notificationPreferencesRepository.js';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../repositories/notificationPreferencesRepository.js';

/**
 * `fcm_token` is deliberately never a field here — see `shared/schema.graphql`'s
 * `NotificationPreferences` doc comment (E2E_MVP_PLAN.md §14.2.6).
 */
export interface GraphQLNotificationPreferences {
  householdId: string;
  listChanges: boolean;
  mealReminder: boolean;
  expiry: boolean;
  activity: boolean;
}

export const toGraphQLNotificationPreferences = (
  row: NotificationPreferencesRow,
): GraphQLNotificationPreferences => ({
  householdId: row.householdId,
  listChanges: row.listChanges,
  mealReminder: row.mealReminder,
  expiry: row.expiry,
  activity: row.activity,
});

/** The no-row-yet case — `Query.notificationPreferences`' pure-read default. */
export const defaultGraphQLNotificationPreferences = (householdId: string): GraphQLNotificationPreferences => ({
  householdId,
  ...DEFAULT_NOTIFICATION_PREFERENCES,
});
