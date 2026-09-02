import { z } from 'zod';
import { householdIdSchema } from './householdId.js';
import { normalizeThenEnum } from './recipeShared.js';
import { RECIPE_ROLE_VALUES } from '../domain/recipeRoles.js';

/**
 * `Menu.weekStartDate`'s locked SDL type is `AWSDateTime!` even though
 * `menus.week_start_date` is a plain `DATE` column (E2E_MVP_PLAN.md
 * §15.2.4) — a week boundary is a calendar date, deliberately not
 * timezone-attached. This schema accepts the full `AWSDateTime` shape a
 * client sends (`YYYY-MM-DDThh:mm:ss.sssZ`) and derives just the
 * `YYYY-MM-DD` part for the DB parameter — the time-of-day component is
 * never read or stored. Rejects a malformed value with a clear message
 * rather than letting an unparseable date reach `pg` as a raw
 * `22P02`/`22007` error.
 *
 * The calendar-date check re-derives `YYYY-MM-DD` from the parsed `Date`'s
 * own UTC components and compares it back against the input string, rather
 * than only checking `getTime()` for `NaN` — the JS `Date` constructor is
 * overflow-tolerant (`"2026-02-30"` silently rolls forward to March 2
 * instead of producing `NaN`), so a `getTime()`-only check would let an
 * out-of-range calendar date through and on to Postgres as a raw `DATE`
 * literal, defeating the point of validating here at all.
 */
export const weekStartDateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
    'weekStartDate must be a valid AWSDateTime (YYYY-MM-DDThh:mm:ss.sssZ)',
  )
  .transform((value) => value.slice(0, 10))
  .refine(
    (dateOnly) => {
      // The preceding regex already guarantees an all-digit YYYY-MM-DD
      // shape, so this Date is never NaN — only overflow (e.g. "2026-02-30"
      // rolling forward to March 2) is possible here, which this
      // round-trip comparison catches.
      const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
      const year = parsed.getUTCFullYear().toString().padStart(4, '0');
      const month = (parsed.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = parsed.getUTCDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}` === dateOnly;
    },
    { message: 'weekStartDate must be a valid calendar date' },
  );

export const createMenuArgsSchema = z.object({
  householdId: householdIdSchema,
  weekStartDate: weekStartDateSchema,
});

export type CreateMenuArgs = z.infer<typeof createMenuArgsSchema>;

export const menuArgsSchema = z.object({
  householdId: householdIdSchema,
  weekStartDate: weekStartDateSchema,
});

export type MenuArgs = z.infer<typeof menuArgsSchema>;

// Mirrors `shared/schema.graphql`'s `MealType` enum exactly (breakfast,
// lunch, snacks, dinner) — see `validation/updateHouseholdSettings.ts`'s own
// identical `MEAL_TYPES` constant; not shared from a common module today
// since neither file has a natural home for one yet, same duplication this
// codebase already accepted there.
const MEAL_TYPE_VALUES = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;

const mealTypeSchema = normalizeThenEnum(MEAL_TYPE_VALUES);
const recipeRoleSchema = normalizeThenEnum(RECIPE_ROLE_VALUES);

const menuIdSchema = z.string().uuid('menuId must be a valid UUID');
const recipeIdSchema = z.string().uuid('recipeId must be a valid UUID');

/**
 * `dayOfWeek` mirrors `menu_items.day_of_week`'s own `CHECK (day_of_week
 * BETWEEN 0 AND 6)` — validated here too so an out-of-range value surfaces
 * as a typed `ValidationError` before it ever reaches that constraint as a
 * raw `pg` `23514` error.
 */
export const menuItemInputSchema = z.object({
  recipeId: recipeIdSchema,
  dayOfWeek: z.number().int().min(0, 'dayOfWeek must be between 0 and 6').max(6, 'dayOfWeek must be between 0 and 6'),
  mealSlot: mealTypeSchema,
  slotRole: recipeRoleSchema,
  servingsOverride: z.number().int().positive('servingsOverride must be a positive integer').nullish(),
});

export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export const addMenuItemArgsSchema = z.object({
  menuId: menuIdSchema,
  input: menuItemInputSchema,
});

export type AddMenuItemArgs = z.infer<typeof addMenuItemArgsSchema>;

export const removeMenuItemArgsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export type RemoveMenuItemArgs = z.infer<typeof removeMenuItemArgsSchema>;
