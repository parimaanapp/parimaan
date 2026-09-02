import { z } from 'zod';
import { householdIdSchema } from './householdId.js';

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
