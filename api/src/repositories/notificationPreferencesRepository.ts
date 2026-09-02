import type { PoolClient } from 'pg';

export interface NotificationPreferencesRow {
  userId: string;
  householdId: string;
  listChanges: boolean;
  mealReminder: boolean;
  expiry: boolean;
  activity: boolean;
}

interface RawNotificationPreferencesRow {
  user_id: string;
  household_id: string;
  list_changes: boolean;
  meal_reminder: boolean;
  expiry: boolean;
  activity: boolean;
}

const mapRow = (row: RawNotificationPreferencesRow): NotificationPreferencesRow => ({
  userId: row.user_id,
  householdId: row.household_id,
  listChanges: row.list_changes,
  mealReminder: row.meal_reminder,
  expiry: row.expiry,
  activity: row.activity,
});

/**
 * SD §7.1's per-column `NOT NULL DEFAULT TRUE` values, restated here for the
 * no-row-yet read path (`findNotificationPreferences` returning `null`) —
 * `Query.notificationPreferences` materialises these in memory rather than
 * writing a row on a read (E2E_MVP_PLAN.md §14: "decide and assert, don't
 * leave it emergent" — decided as a pure, side-effect-free read).
 */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  listChanges: true,
  mealReminder: true,
  expiry: true,
  activity: true,
} as const;

/**
 * Column list is explicit, never `SELECT *` — this table also has
 * `fcm_token` (SD §7.1), a device push credential with no reason to ever
 * enter this codebase's memory outside the (not-yet-built) W20 send path.
 */
const SELECT_COLUMNS = 'user_id, household_id, list_changes, meal_reminder, expiry, activity';

/**
 * Reads the CALLER's own row for `(userId, householdId)` — never another
 * member's. `null` (not a thrown error) if no row exists yet; callers decide
 * how to fill that in (`Query.notificationPreferences` uses
 * {@link DEFAULT_NOTIFICATION_PREFERENCES}).
 *
 * Subject to `notification_preferences`'s own per-user RLS policy (W8 S7)
 * — must run inside a `withUserTransaction(userId, ...)` scope. The calling
 * resolver additionally gates on `requireHouseholdMember` first (the
 * primary, layer-2 authorization check that the household itself is real
 * and the caller belongs to it); RLS here is defense-in-depth for the
 * per-user scoping, not the only check.
 */
export const findNotificationPreferences = async (
  client: PoolClient,
  userId: string,
  householdId: string,
): Promise<NotificationPreferencesRow | null> => {
  const result = await client.query<RawNotificationPreferencesRow>(
    `SELECT ${SELECT_COLUMNS} FROM notification_preferences WHERE user_id = $1 AND household_id = $2`,
    [userId, householdId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRow(row);
};

/**
 * Mirrors `validation/notificationPreferences.ts`'s
 * `NotificationPreferencesPatchInput` exactly (absent field = "leave
 * unchanged"; enforced at the Zod boundary before it ever reaches here).
 */
export interface NotificationPreferencesPatch {
  listChanges?: boolean;
  mealReminder?: boolean;
  expiry?: boolean;
  activity?: boolean;
}

/**
 * Applies `patch` to the CALLER's own `(userId, householdId)` row via a
 * single `INSERT ... ON CONFLICT (user_id, household_id) DO UPDATE`
 * statement — this table has no "create the row" step separate from "update
 * it" (unlike `household_settings`, which is always created by
 * `createHousehold`), so the first successful patch for a pair both creates
 * and applies it in one statement. An absent patch field binds SQL `null`;
 * on INSERT that `COALESCE`s to the SD-specified `TRUE` default, and on
 * conflict it `COALESCE`s to the existing column's value (unchanged) — the
 * same "absent = unchanged" pattern `householdRepository.ts`'s
 * `updateSettingsPartial` already uses, extended to also cover the
 * first-row-ever case in the same statement.
 *
 * Subject to `notification_preferences`'s own per-user RLS policy — must
 * run inside a `withUserTransaction(userId, ...)` scope, and the calling
 * resolver gates on `requireHouseholdMember` first, same division of
 * responsibility as `findNotificationPreferences` above.
 */
export const upsertNotificationPreferencesPartial = async (
  client: PoolClient,
  userId: string,
  householdId: string,
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferencesRow> => {
  const toBoolParam = (value: boolean | undefined): boolean | null => value ?? null;

  const result = await client.query<RawNotificationPreferencesRow>(
    `INSERT INTO notification_preferences (user_id, household_id, list_changes, meal_reminder, expiry, activity)
     VALUES ($1, $2, COALESCE($3, TRUE), COALESCE($4, TRUE), COALESCE($5, TRUE), COALESCE($6, TRUE))
     ON CONFLICT (user_id, household_id) DO UPDATE SET
       list_changes = COALESCE($3, notification_preferences.list_changes),
       meal_reminder = COALESCE($4, notification_preferences.meal_reminder),
       expiry = COALESCE($5, notification_preferences.expiry),
       activity = COALESCE($6, notification_preferences.activity)
     RETURNING ${SELECT_COLUMNS}`,
    [
      userId,
      householdId,
      toBoolParam(patch.listChanges),
      toBoolParam(patch.mealReminder),
      toBoolParam(patch.expiry),
      toBoolParam(patch.activity),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('upsertNotificationPreferencesPartial: expected a returned row.');
  }
  return mapRow(row);
};
