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

/** `Query.autoFillPreview`'s only argument — a pure read, proposes without writing (W10 §16.2.1, D3). */
export const autoFillPreviewArgsSchema = z.object({
  menuId: menuIdSchema,
});

export type AutoFillPreviewArgs = z.infer<typeof autoFillPreviewArgsSchema>;

/**
 * The largest `items` array `autoFillWeek` will accept in one call.
 * `updateHouseholdSettings.ts`'s own `mealStructureEntrySchema` caps each of
 * `carb`/`sabzi_dal`/`accompaniment` at 10 per meal — the theoretical
 * maximum a household could ever configure is 62/day (2 x 3 roles x 10, plus
 * 1 breakfast + 1 snack) x 7 days = 434. 500 is a round, generously-above
 * bound on top of that real ceiling, not an arbitrary guess — closes a
 * defense-in-depth gap security-reviewer flagged: without it, `commitAllItems`
 * would process an unbounded array sequentially, one DB round trip per item,
 * all held under `lockMenu` for the whole call.
 */
const MAX_AUTOFILL_ITEMS = 500;

/**
 * `Mutation.autoFillWeek`'s commit (W10 §16.2.1, D3) — `items` is exactly
 * `MenuItemInput[]`, the same shape a `Query.autoFillPreview` response's
 * `ProposedMenuItem`s echo back, possibly edited by the user via manual
 * swaps before accepting. `overwrite` is required, not nullable — unlike
 * every patch-style optional field elsewhere in this schema, this is a
 * genuine two-valued instruction with no "leave unchanged" reading, so
 * `.nullish()`'s absent-means-unchanged convention does not apply here.
 */
export const autoFillWeekArgsSchema = z.object({
  menuId: menuIdSchema,
  overwrite: z.boolean(),
  items: z.array(menuItemInputSchema).max(MAX_AUTOFILL_ITEMS, `items must contain at most ${MAX_AUTOFILL_ITEMS} entries`),
});

export type AutoFillWeekArgs = z.infer<typeof autoFillWeekArgsSchema>;

/** `Mutation.markMade`'s only argument (W12 S2, E2E_MVP_PLAN.md §18.3 S2). */
export const markMadeArgsSchema = z.object({
  menuItemId: z.string().uuid('menuItemId must be a valid UUID'),
});

export type MarkMadeArgs = z.infer<typeof markMadeArgsSchema>;
