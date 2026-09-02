import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

/** Validates `Query.notificationPreferences`'s `{ householdId: ID! }` argument. */
export const notificationPreferencesArgsSchema = z.object({
  householdId: householdIdSchema,
});

export type NotificationPreferencesArgs = z.infer<typeof notificationPreferencesArgsSchema>;

/**
 * A partial patch — every field `.optional()`, deliberately NOT `.nullable()`.
 * An absent field means "leave unchanged"; an explicit `null` is rejected as
 * a `ValidationError` (Zod naturally rejects `null` against a non-nullable
 * inner schema), the same `updateHouseholdSettings`/`updatePantryItem`
 * convention. The `.refine` below additionally rejects a patch with every
 * field absent — there is nothing for `updateNotificationPreferences` to do
 * with that.
 */
export const notificationPreferencesPatchInputSchema = z
  .object({
    listChanges: z.boolean().optional(),
    mealReminder: z.boolean().optional(),
    expiry: z.boolean().optional(),
    activity: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Input must contain at least one field to update.',
  });

export type NotificationPreferencesPatchInput = z.infer<typeof notificationPreferencesPatchInputSchema>;

export const updateNotificationPreferencesArgsSchema = z.object({
  householdId: householdIdSchema,
  input: notificationPreferencesPatchInputSchema,
});

export type UpdateNotificationPreferencesArgs = z.infer<typeof updateNotificationPreferencesArgsSchema>;
