import type { PoolClient } from 'pg';
import { toAwsDateString } from '../domain/pgDate.js';

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

const mapPantryItemRow = (row: RawPantryItemRow): PantryItemRow => ({
  id: row.id,
  householdId: row.household_id,
  name: row.name,
  quantity: Number(row.quantity),
  unit: row.unit,
  category: row.category,
  isStaple: row.is_staple,
  expiryDate: row.expiry_date === null ? null : toAwsDateString(row.expiry_date),
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

/**
 * Looks up a single pantry item by id, with no `householdId` to check
 * against — `updatePantryItem`/`deletePantryItem` take only `id` (see
 * `shared/schema.graphql`'s doc on both), so there is no client-supplied
 * household context to gate on *before* this query the way
 * `requireHouseholdMember` does for every other household-scoped resolver.
 * RLS is therefore the only thing standing between a caller and an item
 * belonging to someone else's household here — a non-member's query for a
 * real item in another household returns `null`, indistinguishable from
 * the item simply not existing (see `resolvers/updatePantryItem.ts`'s doc
 * for how that collapses into one denial response).
 */
export const findPantryItemById = async (
  client: PoolClient,
  id: string,
): Promise<PantryItemRow | null> => {
  const result = await client.query<RawPantryItemRow>(`SELECT * FROM pantry_items WHERE id = $1`, [
    id,
  ]);
  const row = result.rows[0];
  return row === undefined ? null : mapPantryItemRow(row);
};

export interface PantryItemPatch {
  name?: string;
  quantity?: number;
  unit?: string;
  category?: string;
  isStaple?: boolean;
  /** `YYYY-MM-DD`. */
  expiryDate?: string;
  lowThreshold?: number;
}

/**
 * Applies `patch` to a single `pantry_items` row via one `UPDATE ... SET
 * col = COALESCE($n, col), ...` statement — identical pattern to
 * `householdRepository.ts`'s `updateSettingsPartial`: an absent patch field
 * binds SQL `null`, and `COALESCE` keeps that column's existing value
 * unchanged. Returns `null` if no row matched `id` — either it doesn't
 * exist, or (via RLS's `USING` clause) it belongs to a household the caller
 * isn't a member of; see `findPantryItemById`'s doc for why those two cases
 * are indistinguishable by design here.
 */
export const updatePantryItemPartial = async (
  client: PoolClient,
  id: string,
  patch: PantryItemPatch,
): Promise<PantryItemRow | null> => {
  const result = await client.query<RawPantryItemRow>(
    `UPDATE pantry_items SET
       name = COALESCE($2::text, name),
       quantity = COALESCE($3::numeric, quantity),
       unit = COALESCE($4::text, unit),
       category = COALESCE($5::text, category),
       is_staple = COALESCE($6::boolean, is_staple),
       expiry_date = COALESCE($7::date, expiry_date),
       low_threshold = COALESCE($8::numeric, low_threshold),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.quantity ?? null,
      patch.unit ?? null,
      patch.category ?? null,
      patch.isStaple ?? null,
      patch.expiryDate ?? null,
      patch.lowThreshold ?? null,
    ],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapPantryItemRow(row);
};

/**
 * Deletes a single pantry item by id and returns the row that was deleted
 * (`null` if none matched — same indistinguishable not-found-vs-not-mine
 * reasoning as `findPantryItemById`). Returning the deleted row rather than
 * a boolean is what lets `Mutation.deletePantryItem` report `PantryItem!`
 * instead of `Boolean!` (§11.2.1) — a future `onPantryChanged` subscriber
 * needs to know *which* item vanished, not just that a delete happened
 * somewhere.
 */
export const deletePantryItemById = async (
  client: PoolClient,
  id: string,
): Promise<PantryItemRow | null> => {
  const result = await client.query<RawPantryItemRow>(
    `DELETE FROM pantry_items WHERE id = $1 RETURNING *`,
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapPantryItemRow(row);
};
