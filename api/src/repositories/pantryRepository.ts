import type { PoolClient } from 'pg';

export interface PantryItemRow {
  id: string;
  householdId: string;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  isStaple: boolean;
  /** `YYYY-MM-DD`, or `null` — see `shared/schema.graphql`'s `PantryItem.expiryDate` doc. */
  expiryDate: string | null;
  lowThreshold: number | null;
  addedBy: string;
  addedAt: Date;
  updatedAt: Date;
}

interface RawPantryItemRow {
  id: string;
  household_id: string;
  name: string;
  // `NUMERIC` columns come back from `pg` as strings (its default type
  // parser avoids silent float-precision loss) — converted to `number` here
  // since the GraphQL side is `Float`, not a decimal-safe string scalar.
  quantity: string;
  unit: string;
  category: string | null;
  is_staple: boolean;
  expiry_date: Date | null;
  low_threshold: string | null;
  added_by: string;
  added_at: Date;
  updated_at: Date;
}

/**
 * `YYYY-MM-DD` from a `pg`-parsed `DATE` column's `Date` object.
 *
 * Deliberately reads LOCAL components (`getFullYear`/`getMonth`/`getDate`),
 * not `toISOString()`'s UTC ones — `pg`'s underlying `postgres-date` parser
 * constructs this `Date` at *local* midnight of the SQL date, not UTC
 * midnight (verified empirically: on a UTC+5:30 machine, a `DATE` of
 * `2027-03-01` round-tripped through `toISOString().slice(0, 10)` came back
 * as `2027-02-28` — the exact off-by-one-day bug this comment exists to
 * prevent regressing to). Using local getters here reads back the same
 * calendar date the parser was constructed from, regardless of the
 * process's timezone.
 */
const toAwsDate = (value: Date): string => {
  const year = value.getFullYear().toString().padStart(4, '0');
  const month = (value.getMonth() + 1).toString().padStart(2, '0');
  const day = value.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const mapPantryItemRow = (row: RawPantryItemRow): PantryItemRow => ({
  id: row.id,
  householdId: row.household_id,
  name: row.name,
  quantity: Number(row.quantity),
  unit: row.unit,
  category: row.category,
  isStaple: row.is_staple,
  expiryDate: row.expiry_date === null ? null : toAwsDate(row.expiry_date),
  lowThreshold: row.low_threshold === null ? null : Number(row.low_threshold),
  addedBy: row.added_by,
  addedAt: row.added_at,
  updatedAt: row.updated_at,
});

export interface InsertPantryItemInput {
  householdId: string;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  isStaple: boolean;
  expiryDate: string | null;
  lowThreshold: number | null;
  addedBy: string;
}

export const insertPantryItem = async (
  client: PoolClient,
  input: InsertPantryItemInput,
): Promise<PantryItemRow> => {
  const result = await client.query<RawPantryItemRow>(
    `INSERT INTO pantry_items
       (household_id, name, quantity, unit, category, is_staple, expiry_date, low_threshold, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.householdId,
      input.name,
      input.quantity,
      input.unit,
      input.category,
      input.isStaple,
      input.expiryDate,
      input.lowThreshold,
      input.addedBy,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insertPantryItem: expected a returned row.');
  }
  return mapPantryItemRow(row);
};

export interface FindPantryItemsFilter {
  /** Case-insensitive substring match against `name`. Absent = no filter. */
  search?: string;
  /** Exact match against `category`. Absent = no filter. */
  category?: string;
}

/**
 * Both filters are applied as bind parameters, never string-concatenated
 * into the SQL text — that is what makes this injection-proof, not any
 * escaping logic. A `search` value like `%' OR '1'='1` is bound as a plain
 * string value inside the `LIKE` pattern and matched literally; it cannot
 * break out of the parameter into the surrounding SQL.
 *
 * Uses `idx_pantry_household_name (household_id, LOWER(name))` for the
 * `household_id` equality at minimum; a leading-wildcard `LIKE` can't use a
 * B-tree index for the substring part itself, which is an accepted
 * trade-off for the pantry sizes this MVP deals with (dozens of items per
 * household, not thousands).
 */
export const findPantryItems = async (
  client: PoolClient,
  householdId: string,
  filter: FindPantryItemsFilter = {},
): Promise<PantryItemRow[]> => {
  const result = await client.query<RawPantryItemRow>(
    `SELECT * FROM pantry_items
     WHERE household_id = $1
       AND ($2::text IS NULL OR LOWER(name) LIKE '%' || LOWER($2) || '%')
       AND ($3::text IS NULL OR category = $3)
     ORDER BY LOWER(name)`,
    [householdId, filter.search ?? null, filter.category ?? null],
  );
  return result.rows.map(mapPantryItemRow);
};
